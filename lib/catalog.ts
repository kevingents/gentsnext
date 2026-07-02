import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { getDb } from "@/db";
import {
  products,
  productVariants,
  productImages,
  productCollections,
  collections,
  productTranslations,
  productSizeMedia,
  orders,
  orderLines,
  events,
} from "@/db/schema";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getLocale } from "@/lib/locale-server";
import { COLOR_FAMILIES, type ColorFamily } from "@/lib/colors";
import { NEW_COLLECTION_HANDLE } from "@/lib/new-collection";
import { mySizeBuckets } from "@/lib/size-match";
import { rowSortIndex, rowDisplayLabel } from "@/lib/size-taxonomy";
import { isSizeToken, expandSynonyms, parseSynonyms } from "@/lib/search-helpers";
import { getSettings } from "@/lib/settings";

/** Leeslaag voor de storefront — alle catalogus-queries op één plek. */

/**
 * Zichtbaarheidsregel voor de catalogus: alleen actieve producten MÉT foto,
 * MÉT voorraad, en alleen het PRIMAIRE product van een kleurgroep (de andere
 * kleuren zijn als variant bereikbaar via de PDP). Eén plek, overal hergebruikt.
 */
function visibleProductConds(): SQL[] {
  return [
    eq(products.status, "active"),
    eq(products.hasImage, true),
    eq(products.inStock, true),
    eq(products.isGroupPrimary, true),
  ];
}

export type ProductCardData = {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  imageUrl: string;
  imageAlt: string;
  /** AI-modelfoto (of sfeerbeeld als terugval) — getoond bij hover over de kaart. */
  hoverImageUrl?: string;
  minPriceCents: number;
  hasPriceRange: boolean;
  isNew?: boolean;
  hasSale?: boolean;
  /** Hoogste compareAt-prijs voor de variant die nu op sale is — voor doorstrepen. */
  compareAtCents?: number;
  /** Aantal kleuren in de variantgroep (≥2 → toon "+N kleuren" op de kaart). */
  colorCount?: number;
  /** Lage voorraad → eerlijke schaarste-badge ("Laatste exemplaren"). */
  lowStock?: boolean;
  /** Beschikbare maten (op voorraad) — gevuld in zoekresultaten. */
  availableSizes?: string[];
  /** Hoofdgroep/categorie — voor zoek-facetten. */
  category?: string;
};

export async function listCollections() {
  const db = getDb();
  return db
    .select({
      id: collections.id,
      handle: collections.handle,
      title: collections.title,
      descriptionHtml: collections.descriptionHtml,
    })
    .from(collections)
    .orderBy(asc(collections.position), asc(collections.title));
}

export async function getCollectionByHandle(handle: string) {
  const db = getDb();
  const rows = await db.select().from(collections).where(eq(collections.handle, handle)).limit(1);
  return rows[0] ?? null;
}

// Categorieën waar de PLP-kaart met de MODELFOTO leidt (apparel, gedragen oogt
// editorial). Accessoires/schoenen blijven op de packshot — die tonen we 'heel'.
const MODEL_LEAD_CATS = new Set([
  "Pakken", "Colberts", "Gilets", "Broeken", "Overhemden", "Truien", "Vesten", "Polo-shirts", "T-Shirts", "Jassen",
]);

async function buildProductCards(
  base: { id: string; handle: string; title: string; vendor: string }[]
): Promise<ProductCardData[]> {
  const db = getDb();
  const ids = base.map((p) => p.id);
  if (!ids.length) return [];

  const [images, variants, prodMeta] = await Promise.all([
    db
      .select({
        productId: productImages.productId,
        url: productImages.url,
        alt: productImages.alt,
        position: productImages.position,
      })
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.position)),
    db
      .select({
        productId: productVariants.productId,
        priceCents: productVariants.priceCents,
        compareAtCents: productVariants.compareAtCents,
      })
      .from(productVariants)
      .where(inArray(productVariants.productId, ids)),
    db
      .select({
        id: products.id,
        sourceCreatedAt: products.sourceCreatedAt,
        attributes: products.attributes,
        groupColorCount: products.groupColorCount,
        variantColorLabel: products.variantColorLabel,
        stockQty: products.stockQty,
        modelImageUrl: products.modelImageUrl,
        lifestyleImageUrl: products.lifestyleImageUrl,
      })
      .from(products)
      .where(inArray(products.id, ids)),
  ]);

  const colorCount = new Map(prodMeta.map((m) => [m.id, m.groupColorCount]));
  const colorLabel = new Map(prodMeta.map((m) => [m.id, m.variantColorLabel]));
  const stockQtyById = new Map(prodMeta.map((m) => [m.id, m.stockQty]));
  // Hover-beeld: modelfoto wint, anders sfeerbeeld. Leeg = geen swap.
  const hoverById = new Map(prodMeta.map((m) => [m.id, (m.modelImageUrl || m.lifestyleImageUrl || "").trim()]));
  const modelById = new Map(prodMeta.map((m) => [m.id, (m.modelImageUrl || "").trim()]));
  const categoryById = new Map(
    prodMeta.map((m) => [m.id, String((m.attributes as Record<string, unknown>)?.hoofdgroep_omschrijving || "")])
  );

  const firstImage = new Map<string, { url: string; alt: string }>();
  for (const img of images) {
    if (!firstImage.has(img.productId)) firstImage.set(img.productId, { url: img.url, alt: img.alt });
  }
  const priceRange = new Map<string, { min: number; max: number }>();
  const onSale = new Map<string, boolean>();
  const compareAtBest = new Map<string, number>();
  for (const v of variants) {
    const range = priceRange.get(v.productId);
    if (!range) priceRange.set(v.productId, { min: v.priceCents, max: v.priceCents });
    else {
      range.min = Math.min(range.min, v.priceCents);
      range.max = Math.max(range.max, v.priceCents);
    }
    if (v.compareAtCents && v.compareAtCents > v.priceCents) {
      onSale.set(v.productId, true);
      const cur = compareAtBest.get(v.productId) ?? 0;
      if (v.compareAtCents > cur) compareAtBest.set(v.productId, v.compareAtCents);
    }
  }

  const NEW_DAYS = 30;
  const newThreshold = Date.now() - NEW_DAYS * 86400000;
  const newFlag = new Map<string, boolean>();
  for (const m of prodMeta) {
    const attrs = (m.attributes ?? {}) as Record<string, unknown>;
    const explicit = String(attrs.new ?? "").toLowerCase() === "ja";
    const recent = m.sourceCreatedAt ? new Date(m.sourceCreatedAt).getTime() > newThreshold : false;
    if (explicit || recent) newFlag.set(m.id, true);
  }

  // Alt-tekst-strategie: Shopify-alt alleen behouden als hij Nederlands lijkt;
  // anders consistente NL-fallback. Voorkomt half-Engelse alt-tags voor SEO/AI.
  const isEnglishish = (s: string) =>
    /\b(the|with|smiling|man|stylish|wearing|worn|outfit|shirt|trousers)\b/i.test(s);

  // Vertaalde titels voor niet-NL locale (AI-vertaling, product_translations).
  const locale = await getLocale();
  const titleTl = new Map<string, string>();
  if (locale !== DEFAULT_LOCALE) {
    const tls = await db
      .select({ productId: productTranslations.productId, title: productTranslations.title })
      .from(productTranslations)
      .where(and(inArray(productTranslations.productId, ids), eq(productTranslations.locale, locale)));
    for (const t of tls) if (t.title) titleTl.set(t.productId, t.title);
  }

  return base.map((p) => {
    const img = firstImage.get(p.id);
    const range = priceRange.get(p.id);
    const rawAlt = (img?.alt || "").trim();
    const cleanAlt = !rawAlt || isEnglishish(rawAlt) ? p.title : rawAlt;
    const tl = titleTl.get(p.id);
    // Bij een kleurgroep tonen we de BASISnaam op de kaart (kleur weg uit titel),
    // zodat "Stropdas PE lichtblauw" → "Stropdas PE · In 19 kleuren".
    const cnt = colorCount.get(p.id) ?? 1;
    const lbl = (colorLabel.get(p.id) || "").trim();
    let displayTitle = p.title;
    if (cnt > 1 && lbl && p.title.toLowerCase().endsWith(lbl.toLowerCase())) {
      displayTitle = p.title.slice(0, p.title.length - lbl.length).replace(/[\s,–-]+$/, "").trim() || p.title;
    }
    // Vertaling (indien aanwezig) wint voor de weergavetitel.
    if (tl) displayTitle = tl;
    // Apparel met een modelfoto: leid met de modelfoto (editorial), packshot op hover.
    // Accessoires/schoenen of geen modelfoto: packshot leidt, modelfoto/sfeerbeeld op hover.
    const pack = img?.url || "";
    const model = modelById.get(p.id) || "";
    const leadModel = Boolean(model) && MODEL_LEAD_CATS.has(categoryById.get(p.id) || "");
    return {
      id: p.id,
      handle: p.handle,
      title: displayTitle,
      vendor: p.vendor,
      imageUrl: leadModel ? model : pack,
      imageAlt: leadModel ? `${displayTitle} — op model` : cleanAlt,
      hoverImageUrl: leadModel ? pack : hoverById.get(p.id) || "",
      minPriceCents: range?.min ?? 0,
      hasPriceRange: Boolean(range && range.min !== range.max),
      isNew: newFlag.get(p.id) ?? false,
      hasSale: onSale.get(p.id) ?? false,
      compareAtCents: compareAtBest.get(p.id),
      colorCount: colorCount.get(p.id) ?? 1,
      lowStock: (() => {
        const q = stockQtyById.get(p.id) ?? 0;
        return q > 0 && q <= 5;
      })(),
      category: categoryById.get(p.id) || "",
    };
  });
}

export async function getCollectionProducts(collectionId: string, page: number, perPage: number) {
  const db = getDb();
  const baseQuery = and(
    eq(productCollections.collectionId, collectionId),
    ...visibleProductConds()
  );

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: products.id,
        handle: products.handle,
        title: products.title,
        vendor: products.vendor,
      })
      .from(productCollections)
      .innerJoin(products, eq(products.id, productCollections.productId))
      .where(baseQuery)
      .orderBy(asc(productCollections.position), asc(products.title))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db
      .select({ total: count() })
      .from(productCollections)
      .innerJoin(products, eq(products.id, productCollections.productId))
      .where(baseQuery),
  ]);

  return {
    items: await buildProductCards(rows),
    total: totals[0]?.total ?? 0,
  };
}

export async function getProductByHandle(handle: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.handle, handle), eq(products.status, "active")))
    .limit(1);
  const product = rows[0];
  if (!product) return null;

  const [variants, images, links, sizeMediaRows] = await Promise.all([
    db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, product.id))
      .orderBy(asc(productVariants.position)),
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, product.id))
      .orderBy(asc(productImages.position)),
    db
      .select({ handle: collections.handle, title: collections.title })
      .from(productCollections)
      .innerJoin(collections, eq(collections.id, productCollections.collectionId))
      .where(eq(productCollections.productId, product.id))
      .orderBy(asc(productCollections.position)),
    db.select().from(productSizeMedia).where(eq(productSizeMedia.productId, product.id)).limit(1),
  ]);

  const sizeMedia = sizeMediaRows[0]
    ? { threshold: sizeMediaRows[0].threshold, url: sizeMediaRows[0].url, alt: sizeMediaRows[0].alt }
    : null;

  return { product, variants, images, collections: links, sizeMedia };
}

export async function listProductHandles(limit = 50000) {
  const db = getDb();
  return db
    .select({ handle: products.handle, updatedAt: products.updatedAt })
    .from(products)
    .where(and(...visibleProductConds()))
    .limit(limit);
}

/* ───────────────────────── Gefilterde PLP + facetten ───────────────────── */

export type ProductSort = "aanbevolen" | "populair" | "nieuw" | "prijs-op" | "prijs-af" | "naam";

/**
 * Rang-context voor de "Aanbevolen"-sort (de slimme default). Alle velden
 * optioneel: zonder context valt "Aanbevolen" terug op de objectieve blend
 * (populariteit · maatbreedte · voorraad · versheid). De boosts herschikken
 * alleen — ze filteren niet — dus de totaaltelling en paginering blijven kloppen.
 */
export type PlpRankContext = {
  /** Filter-buckets (size_label) van het maatprofiel van de klant → in-jouw-maat vooraan. */
  mySizeRows?: string[];
  /** Vertrouwde hoofdgroepen uit de aankoophistorie → gepersonaliseerde boost. */
  tasteCats?: string[];
  /** Merchandising-pins (product-handles, in volgorde) → altijd bovenaan in de default. */
  pinnedHandles?: string[];
  /** Populariteits-venster in dagen (default 30). */
  popularityDays?: number;
};

/**
 * Smaak-categorieën (hoofdgroep) van een klant uit z'n aankoophistorie — voor de
 * gepersonaliseerde boost op de PLP. Lichtgewicht (één query); leeg zonder klant
 * of historie. Hergebruikt de logica van getRecommendedFromHistory.
 */
export async function getCustomerTasteCats(customerId: string, limit = 4): Promise<string[]> {
  if (!customerId) return [];
  const db = getDb();
  const res = await db.execute<{ hg: string }>(sql`
    select p.attributes ->> 'hoofdgroep_omschrijving' hg
    from ${orderLines} ol
    join ${orders} o on o.id = ol.order_id
    join ${productVariants} v on v.sku = ol.sku
    join ${products} p on p.id = v.product_id
    where o.customer_id = ${customerId} and o.status in ('paid','shipped','delivered','ready_pickup')
      and coalesce(p.attributes ->> 'hoofdgroep_omschrijving','') <> ''
    group by 1 order by count(*) desc limit ${limit}
  `);
  return res.rows.map((r) => r.hg).filter(Boolean);
}

export type ProductFilters = {
  collectionId?: string;
  category?: string; // hoofdgroep_omschrijving
  types?: string[]; // subgroep (chino/pantalon/lange mouw/…)
  materials?: string[]; // materiaal
  patterns?: string[]; // print_design (dessin)
  seasons?: string[]; // seizoen
  ironFree?: boolean; // strijkvrij = Ja
  colorFamilies?: string[];
  sizes?: string[];
  fits?: string[];
  priceMinCents?: number;
  priceMaxCents?: number;
};

export type Facets = {
  types: { value: string; label: string; count: number }[];
  materials: { value: string; count: number }[];
  patterns: { value: string; count: number }[];
  seasons: { value: string; count: number }[];
  ironFreeCount: number;
  colors: { key: ColorFamily; label: string; hex: string; count: number }[];
  sizes: { value: string; label: string; count: number }[];
  fits: { value: string; count: number }[];
  priceMinCents: number;
  priceMaxCents: number;
};

const REAL_SEASONS = new Set(["Lente/Zomer", "Herfst/Winter", "Voorjaar", "Najaar", "Zomer", "Winter", "Lente", "Herfst"]);

/** "MM" = mix & match — nettere weergave in het type-filter. */
export function typeLabel(v: string): string {
  if (v === "MM" || v === "Gilet MM") return v === "MM" ? "Mix & match" : "Gilet (mix & match)";
  return v;
}

/** Product-niveau condities (collectie/categorie) — bepalen de facet-context. */
function contextConditions(f: ProductFilters): SQL[] {
  const conds: SQL[] = [...visibleProductConds()];
  if (f.collectionId) {
    conds.push(
      sql`exists (select 1 from ${productCollections} pc where pc.product_id = ${products.id} and pc.collection_id = ${f.collectionId})`
    );
  }
  if (f.category) {
    conds.push(sql`${products.attributes} ->> 'hoofdgroep_omschrijving' = ${f.category}`);
  }
  return conds;
}

/** Productkaarten voor een lijst handles (favorieten/recent bekeken). */
export async function getProductsByHandles(handles: string[]): Promise<ProductCardData[]> {
  const list = [...new Set(handles)].slice(0, 60);
  if (!list.length) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: products.id,
      handle: products.handle,
      title: products.title,
      vendor: products.vendor,
    })
    .from(products)
    // Bewaarde/recent-bekeken items: tonen zolang ze actief zijn én een foto
    // hebben (geen lege kaarten); voorraad mag tijdelijk 0 zijn.
    .where(and(inArray(products.handle, list), eq(products.status, "active"), eq(products.hasImage, true)));
  // Volgorde van de invoer behouden.
  const cards = await buildProductCards(rows);
  const byHandle = new Map(cards.map((c) => [c.handle, c]));
  return list.map((h) => byHandle.get(h)).filter(Boolean) as ProductCardData[];
}

/** Producten van een merk (uit het 'merk'-attribute), nieuwste eerst. */
export async function getProductsByBrand(brand: string, limit = 48): Promise<ProductCardData[]> {
  const db = getDb();
  const rows = await db.execute<{ id: string; handle: string; title: string; vendor: string }>(sql`
    select p.id, p.handle, p.title, p.vendor
    from ${products} p
    where p.status = 'active' and p.has_image = true and p.in_stock = true and p.is_group_primary = true
      and p.attributes ->> 'merk' = ${brand}
    order by p.source_created_at desc nulls last
    limit ${limit}
  `);
  return buildProductCards(rows.rows.map((r) => ({ id: r.id, handle: r.handle, title: r.title, vendor: r.vendor })));
}

/**
 * "Nieuw in jouw maat" — new arrivals (de New arrivals-collectie) met minstens
 * één variant op voorraad in een van de bewaarde maten van de klant. Leeg als er
 * geen maatprofiel is. Voor de persoonlijke strip op de accountpagina.
 */
export async function getNewArrivalsInSize(profile: unknown, limit = 4): Promise<ProductCardData[]> {
  const sizes = mySizeBuckets(profile);
  if (!sizes.length) return [];
  const col = await getCollectionByHandle(NEW_COLLECTION_HANDLE);
  if (!col) return [];
  const { items } = await getFilteredProducts({ collectionId: col.id, sizes }, "nieuw", 1, limit);
  return items;
}

/**
 * "Past bij je eerdere bestellingen" — leidt de smaak van de klant af uit z'n
 * aankoophistorie (kleurfamilies via order_lines.sku → variant) en beveelt
 * producten aan in diezelfde kleur(en) én — als bekend — in de bewaarde maat, op
 * voorraad, met uitsluiting van wat al gekocht is. Leeg zonder bruikbare historie.
 */
export async function getRecommendedFromHistory(customerId: string, profile: unknown, limit = 4): Promise<ProductCardData[]> {
  if (!customerId) return [];
  const db = getDb();

  // Smaak: de meest gekochte kleurfamilies (join order-regel → variant).
  const taste = await db.execute<{ color_family: string }>(sql`
    select v.color_family
    from ${orderLines} ol
    join ${orders} o on o.id = ol.order_id
    join ${productVariants} v on v.sku = ol.sku
    where o.customer_id = ${customerId} and o.status in ('paid','shipped','delivered','ready_pickup')
      and coalesce(v.color_family,'') <> ''
    group by v.color_family
    order by count(*) desc
    limit 4
  `);
  const colors = taste.rows.map((r) => r.color_family).filter(Boolean);
  if (!colors.length) return [];

  // Smaak-categorieën (hoofdgroep) uit de historie — voor relevantie-boost.
  const tasteCat = await db.execute<{ hg: string }>(sql`
    select p.attributes ->> 'hoofdgroep_omschrijving' hg
    from ${orderLines} ol
    join ${orders} o on o.id = ol.order_id
    join ${productVariants} v on v.sku = ol.sku
    join ${products} p on p.id = v.product_id
    where o.customer_id = ${customerId} and o.status in ('paid','shipped','delivered','ready_pickup')
      and coalesce(p.attributes ->> 'hoofdgroep_omschrijving','') <> ''
    group by 1 order by count(*) desc limit 4
  `);
  const cats = tasteCat.rows.map((r) => r.hg).filter(Boolean);

  // Alles wat al gekocht is — niet nogmaals aanbevelen.
  const boughtRows = await db.execute<{ product_id: string }>(sql`
    select distinct v.product_id
    from ${orderLines} ol
    join ${orders} o on o.id = ol.order_id
    join ${productVariants} v on v.sku = ol.sku
    where o.customer_id = ${customerId}
  `);
  const bought = boughtRows.rows.map((r) => r.product_id).filter(Boolean);

  const sizes = mySizeBuckets(profile);
  const sizeCond = sizes.length ? sql` and v.size_label in (${sql.join(sizes.map((s) => sql`${s}`), sql`, `)})` : sql``;
  const excludeCond = bought.length ? sql` and p.id not in (${sql.join(bought.map((b) => sql`${b}`), sql`, `)})` : sql``;
  // Producten in een vertrouwde categorie eerst, daarna nieuwste.
  const catBoost = cats.length
    ? sql`(case when p.attributes ->> 'hoofdgroep_omschrijving' in (${sql.join(cats.map((c) => sql`${c}`), sql`, `)}) then 0 else 1 end), `
    : sql``;

  const rows = await db.execute<{ id: string; handle: string; title: string; vendor: string }>(sql`
    select p.id, p.handle, p.title, p.vendor
    from ${products} p
    where p.status = 'active' and p.has_image = true and p.in_stock = true and p.is_group_primary = true
      and exists (
        select 1 from ${productVariants} v
        where v.product_id = p.id and v.stock_qty > 0
          and v.color_family in (${sql.join(colors.map((c) => sql`${c}`), sql`, `)})${sizeCond}
      )${excludeCond}
    order by ${catBoost}p.source_created_at desc nulls last
    limit ${limit}
  `);
  return buildProductCards(rows.rows.map((r) => ({ id: r.id, handle: r.handle, title: r.title, vendor: r.vendor })));
}

/** Bouwt `col in ('a','b')` met correcte placeholders (drizzle expandeert arrays niet in ruwe sql). */
function inList(col: SQL, values: string[]): SQL {
  return sql`${col} in (${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  )})`;
}

/**
 * Variant-niveau EXISTS — één variant moet aan álle gekozen variant-filters
 * voldoen ÉN op voorraad zijn. Filter je op maat S, dan zie je geen producten
 * waar S uitverkocht is (de matchende variant moet leverbaar zijn).
 */
function variantExists(f: ProductFilters): SQL | null {
  const parts: SQL[] = [sql`v.product_id = ${products.id}`];
  let active = false;
  if (f.colorFamilies?.length) {
    parts.push(inList(sql`v.color_family`, f.colorFamilies));
    active = true;
  }
  if (f.sizes?.length) {
    parts.push(inList(sql`v.size_label`, f.sizes));
    active = true;
  }
  if (typeof f.priceMinCents === "number") {
    parts.push(sql`v.price_cents >= ${f.priceMinCents}`);
    active = true;
  }
  if (typeof f.priceMaxCents === "number") {
    parts.push(sql`v.price_cents <= ${f.priceMaxCents}`);
    active = true;
  }
  if (!active) return null;
  // De matchende variant moet op voorraad zijn (geen uitverkochte maten tonen).
  parts.push(sql`v.stock_qty > 0`);
  return sql`exists (select 1 from ${productVariants} v where ${sql.join(parts, sql` and `)})`;
}

function allConditions(f: ProductFilters): SQL[] {
  const conds = contextConditions(f);
  if (f.fits?.length) {
    conds.push(inList(sql`${products.attributes} ->> 'pasvorm'`, f.fits));
  }
  if (f.types?.length) {
    conds.push(inList(sql`${products.attributes} ->> 'subgroep'`, f.types));
  }
  if (f.materials?.length) {
    conds.push(inList(sql`${products.attributes} ->> 'materiaal'`, f.materials));
  }
  if (f.patterns?.length) {
    // "Effen" = geen/leeg dessin; combineer met eventuele echte dessins via OR.
    const real = f.patterns.filter((p) => p !== "Effen");
    const ors: SQL[] = [];
    if (real.length) ors.push(inList(sql`${products.attributes} ->> 'print_design'`, real));
    if (f.patterns.includes("Effen")) ors.push(sql`coalesce(trim(${products.attributes} ->> 'print_design'), '') = ''`);
    if (ors.length) conds.push(sql`(${sql.join(ors, sql` or `)})`);
  }
  if (f.seasons?.length) {
    conds.push(inList(sql`${products.attributes} ->> 'seizoen'`, f.seasons));
  }
  if (f.ironFree) {
    conds.push(sql`${products.attributes} ->> 'strijkvrij' = 'Ja'`);
  }
  const ve = variantExists(f);
  if (ve) conds.push(ve);
  return conds;
}

/** Objectieve sorteringen (los van personalisatie). */
const SORT_ORDER: Record<"nieuw" | "prijs-op" | "prijs-af" | "naam", SQL> = {
  nieuw: sql`${products.sourceCreatedAt} desc nulls last`,
  "prijs-op": sql`mp asc nulls last`,
  "prijs-af": sql`mp desc nulls last`,
  naam: sql`${products.title} asc`,
};

/** `col in ('a','b',…)` met correcte placeholders voor een ruwe sql-fragment. */
function sqlInList(values: string[]): SQL {
  return sql.join(values.map((v) => sql`${v}`), sql`, `);
}

/**
 * Bouwt de ORDER BY voor een PLP-sort. "Aanbevolen" (default) blendt:
 *   pins → in-jouw-maat → populariteit → jouw-smaakcategorie → maatbreedte →
 *   voorraad → versheid. "Populair" = objectieve vraag (events). De overige
 *   sorts blijven puur. Retourneert ook of het populariteits-CTE nodig is.
 */
function buildPlpOrder(sort: ProductSort, ctx?: PlpRankContext): { order: SQL; usesPop: boolean } {
  if (sort !== "aanbevolen" && sort !== "populair") {
    return { order: SORT_ORDER[sort], usesPop: false };
  }
  const popScore = sql`coalesce(pop.score, 0)`;
  const breadth = sql`(select count(*) from ${productVariants} vb where vb.product_id = ${products.id} and vb.stock_qty > 0)`;
  const tail = sql`${products.stockQty} desc nulls last, ${products.sourceCreatedAt} desc nulls last`;

  if (sort === "populair") {
    return { order: sql`${popScore} desc, ${tail}`, usesPop: true };
  }

  // "Aanbevolen": optionele boost-prefixes (elk een asc CASE, 0 = relevant).
  const pins = (ctx?.pinnedHandles ?? []).filter(Boolean);
  const pinBoost = pins.length
    ? sql`(case ${sql.join(pins.map((h, i) => sql`when ${products.handle} = ${h} then ${i}`), sql` `)} else ${pins.length} end), `
    : sql``;
  const mySizeRows = (ctx?.mySizeRows ?? []).filter(Boolean);
  const mySizeBoost = mySizeRows.length
    ? sql`(case when exists(select 1 from ${productVariants} vs where vs.product_id = ${products.id} and vs.stock_qty > 0 and vs.size_label in (${sqlInList(mySizeRows)})) then 0 else 1 end), `
    : sql``;
  const tasteCats = (ctx?.tasteCats ?? []).filter(Boolean);
  const tasteBoost = tasteCats.length
    ? sql`(case when ${products.attributes} ->> 'hoofdgroep_omschrijving' in (${sqlInList(tasteCats)}) then 0 else 1 end), `
    : sql``;

  return {
    order: sql`${pinBoost}${mySizeBoost}${popScore} desc, ${tasteBoost}${breadth} desc, ${tail}`,
    usesPop: true,
  };
}

export async function getFilteredProducts(
  f: ProductFilters,
  sort: ProductSort,
  page: number,
  perPage: number,
  ctx?: PlpRankContext
): Promise<{ items: ProductCardData[]; total: number }> {
  const db = getDb();
  const conds = allConditions(f);
  const whereSql = sql.join(conds, sql` and `);
  const offset = (page - 1) * perPage;

  const { order, usesPop } = buildPlpOrder(sort, ctx);
  // Populariteit: één aggregatie over de events (view=1, add_to_cart=3) in het
  // venster, als CTE gejoined op handle. Alleen voor aanbevolen/populair; de
  // overige sorts draaien exact de oude, lichte query.
  const popDays = Math.max(1, Math.floor(ctx?.popularityDays ?? 30));
  const withPop = usesPop
    ? sql`with pop as (
        select handle, sum(case when type='add_to_cart' then 3 when type='product_view' then 1 else 0 end)::int as score
        from ${events}
        where handle <> '' and type in ('product_view','add_to_cart') and created_at > now() - (${popDays} || ' days')::interval
        group by handle
      ) `
    : sql``;
  const popJoin = usesPop ? sql` left join pop on pop.handle = ${products.handle}` : sql``;

  // Pagineer op product-id met min-prijs voor de prijs-sortering. De kaart-basiskolommen
  // (handle/title/vendor) selecteren we meteen mee → de aparte hydrate-query vervalt, en
  // de id- + count-query draaien parallel (scheelt 2 round-trips op neon-http per PLP).
  const [idRows, totalRes] = await Promise.all([
    db.execute<{ id: string; handle: string; title: string; vendor: string }>(sql`
      ${withPop}select ${products.id} as id, ${products.handle} as handle, ${products.title} as title, ${products.vendor} as vendor,
             (select min(v2.price_cents) from ${productVariants} v2 where v2.product_id = ${products.id}) as mp
      from ${products}${popJoin}
      where ${whereSql}
      order by ${order}
      limit ${perPage} offset ${offset}
    `),
    db.execute<{ n: number }>(sql`select count(*)::int as n from ${products} where ${whereSql}`),
  ]);
  const total = Number(totalRes.rows[0]?.n ?? 0);
  const ordered = idRows.rows.map((r) => ({ id: r.id, handle: r.handle, title: r.title, vendor: r.vendor }));
  if (!ordered.length) return { items: [], total };
  return { items: await buildProductCards(ordered), total };
}

/** Facetten zonder cache-laag (rechtstreeks de DB). getFacets() wrapt dit met caching. */
export async function getFacetsUncached(f: ProductFilters): Promise<Facets> {
  const db = getDb();
  // Facetten binnen de context (collectie/categorie), onafhankelijk van de
  // gekozen kleur/maat/pasvorm — zo blijven alle opties met telling zichtbaar.
  const ctx = sql.join(contextConditions(f), sql` and `);

  // Twee gebundelde queries i.p.v. tien losse round-trips: alle products-attribuut-
  // facetten in één MATERIALIZED CTE (de context wordt één keer gescand), en
  // kleur/maat/prijs (variant-join) in de tweede. Scheelt 8 Neon-round-trips + 8
  // her-scans van dezelfde context.
  const [prodAgg, varAgg] = await Promise.all([
    db.execute<{ facet: string; v: string | null; n: number }>(sql`
      with ctxp as materialized (
        select ${products.id} as id, ${products.attributes} as attributes
        from ${products}
        where ${ctx}
      )
      select 'subgroep' as facet, attributes->>'subgroep' as v, count(*)::int as n from ctxp where coalesce(attributes->>'subgroep','') <> '' group by attributes->>'subgroep'
      union all select 'materiaal', attributes->>'materiaal', count(*)::int from ctxp where coalesce(attributes->>'materiaal','') <> '' group by attributes->>'materiaal'
      union all select 'print_design', attributes->>'print_design', count(*)::int from ctxp where coalesce(attributes->>'print_design','') <> '' group by attributes->>'print_design'
      union all select 'seizoen', attributes->>'seizoen', count(*)::int from ctxp where coalesce(attributes->>'seizoen','') <> '' group by attributes->>'seizoen'
      union all select 'pasvorm', attributes->>'pasvorm', count(*)::int from ctxp where coalesce(attributes->>'pasvorm','') <> '' group by attributes->>'pasvorm'
      union all select 'strijkvrij', ''::text, count(*)::int from ctxp where attributes->>'strijkvrij' = 'Ja'
      union all select 'effen', ''::text, count(*)::int from ctxp where coalesce(trim(attributes->>'print_design'),'') = ''
    `),
    db.execute<{ facet: string; v: string | null; n: number }>(sql`
      with ctxv as materialized (
        select ${products.id} as id, v.color_family, v.size_label, v.stock_qty, v.price_cents
        from ${products} join ${productVariants} v on v.product_id = ${products.id}
        where ${ctx}
      )
      select 'color' as facet, color_family as v, count(distinct id)::int as n from ctxv where color_family <> '' and stock_qty > 0 group by color_family
      union all select 'size', size_label, count(distinct id)::int from ctxv where size_label <> '' and stock_qty > 0 group by size_label
      union all select 'price_lo', ''::text, coalesce(min(price_cents),0)::int from ctxv
      union all select 'price_hi', ''::text, coalesce(max(price_cents),0)::int from ctxv
    `),
  ]);

  const pRows = prodAgg.rows, vRows = varAgg.rows;
  const of = (rows: typeof pRows, facet: string) => rows.filter((r) => r.facet === facet);
  const scalar = (rows: typeof pRows, facet: string) => Number(of(rows, facet)[0]?.n ?? 0);

  const colorCount = new Map(of(vRows, "color").map((r) => [r.v ?? "", r.n]));
  const colors = COLOR_FAMILIES.filter((c) => colorCount.has(c.key)).map((c) => ({ ...c, count: colorCount.get(c.key) ?? 0 }));

  // Lettermaat-buckets (XS/M/L/…) in natuurlijke volgorde.
  const sizes = of(vRows, "size")
    .map((r) => ({ value: r.v ?? "", label: rowDisplayLabel(r.v ?? ""), count: r.n }))
    .sort((a, b) => rowSortIndex(a.value) - rowSortIndex(b.value));

  const fits = of(pRows, "pasvorm").map((r) => ({ value: r.v ?? "", count: r.n })).sort((a, b) => b.count - a.count);

  const types = of(pRows, "subgroep").map((r) => ({ value: r.v ?? "", label: typeLabel(r.v ?? ""), count: r.n })).sort((a, b) => b.count - a.count);

  // Materiaal: alleen tonen wat genoeg voorkomt.
  const materials = of(pRows, "materiaal").map((r) => ({ value: r.v ?? "", count: r.n })).filter((m) => m.count >= 2).sort((a, b) => b.count - a.count).slice(0, 12);

  // Seizoen: alleen echte seizoenen (geen "NOS"/"Black friday"-ruis).
  const seasons = of(pRows, "seizoen").filter((r) => REAL_SEASONS.has(r.v ?? "")).map((r) => ({ value: r.v ?? "", count: r.n })).sort((a, b) => b.count - a.count);

  // "Effen" (geen dessin) als eerste optie — meestal de grootste groep.
  const effenCount = scalar(pRows, "effen");
  const patterns = [
    ...(effenCount >= 2 ? [{ value: "Effen", count: effenCount }] : []),
    ...of(pRows, "print_design").map((r) => ({ value: r.v ?? "", count: r.n })).filter((p) => p.count >= 2).sort((a, b) => b.count - a.count).slice(0, 12),
  ];

  return {
    types, materials, patterns, seasons,
    ironFreeCount: scalar(pRows, "strijkvrij"),
    colors, sizes, fits,
    priceMinCents: scalar(vRows, "price_lo"),
    priceMaxCents: scalar(vRows, "price_hi"),
  };
}

/**
 * Facetten hangen alleen van de context (categorie/collectie) af — niet van de
 * gekozen filters. Daarom cachen we per context (revalidate 180s): een handvol
 * distinct sleutels die door álle bezoekers gedeeld worden, i.p.v. 10 DB-queries
 * per PLP-render. Een catalogus-wijziging is binnen 3 min zichtbaar.
 */
const _facetsCached = unstable_cache(
  (collectionId: string, category: string) => getFacetsUncached({ collectionId: collectionId || undefined, category: category || undefined }),
  ["plp-facets-v2"],
  { revalidate: 180 },
);
export function getFacets(f: ProductFilters): Promise<Facets> {
  return _facetsCached(f.collectionId || "", f.category || "");
}

/* ─────────────────────────── Bijverkoop / cross-sell ──────────────────── */

// Slimme categorie-regels: wat past bij wat ("maak de look compleet").
const CROSS_SELL: Record<string, string[]> = {
  Pakken: ["Overhemden", "Stropdassen", "Schoenen", "Pochet"],
  Colberts: ["Overhemden", "Stropdassen", "Pochet"],
  Broeken: ["Riemen", "Overhemden", "Schoenen"],
  Overhemden: ["Stropdassen", "Manchetknopen", "Colberts"],
  Stropdassen: ["Pochet", "Overhemden", "Dasspelden"],
  Strikken: ["Pochet", "Overhemden", "Manchetknopen"],
  Gilets: ["Overhemden", "Stropdassen"],
  Schoenen: ["Riemen", "Sokken"],
  Truien: ["Overhemden", "Broeken"],
  "Polo-shirts": ["Broeken", "Riemen"],
};
const DEFAULT_CROSS = ["Overhemden", "Stropdassen", "Pochet"];

/**
 * Aanbevelingen om "de look compleet te maken": producten uit complementaire
 * categorieën, met afbeelding, gebalanceerd over de doelcategorieën.
 */
export async function getRecommendations(
  hoofdgroep: string,
  excludeProductId: string | null,
  limit = 4
): Promise<ProductCardData[]> {
  const db = getDb();
  const targets = CROSS_SELL[hoofdgroep] || DEFAULT_CROSS;
  const exclude = excludeProductId || "00000000-0000-0000-0000-000000000000";

  const rows = await db.execute<{ id: string; handle: string; title: string; vendor: string; hg: string }>(sql`
    select p.id, p.handle, p.title, p.vendor, p.attributes ->> 'hoofdgroep_omschrijving' as hg
    from ${products} p
    where p.status = 'active' and p.has_image = true and p.in_stock = true and p.is_group_primary = true
      and p.attributes ->> 'hoofdgroep_omschrijving' in (${sql.join(targets.map((t) => sql`${t}`), sql`, `)})
      and p.id <> ${exclude}
    order by p.source_created_at desc nulls last
    limit 60
  `);

  // Round-robin over de doelcategorieën → variatie (niet 4× hetzelfde type).
  const byCat = new Map<string, typeof rows.rows>();
  for (const r of rows.rows) {
    if (!byCat.has(r.hg)) byCat.set(r.hg, []);
    byCat.get(r.hg)!.push(r);
  }
  const ordered: typeof rows.rows = [];
  let added = true;
  while (ordered.length < limit && added) {
    added = false;
    for (const t of targets) {
      const list = byCat.get(t);
      if (list && list.length) {
        ordered.push(list.shift()!);
        added = true;
        if (ordered.length >= limit) break;
      }
    }
  }
  return buildProductCards(
    ordered.map((r) => ({ id: r.id, handle: r.handle, title: r.title, vendor: r.vendor }))
  );
}

/**
 * Cross-sell voor de orderbevestigingsmail ("hier kochten anderen bij"):
 * complementaire categorieën bij wat er besteld is, op voorraad, exclusief de
 * bestelde producten zelf. Leeg als er niets passends is.
 */
export async function getOrderCrossSell(orderId: string, limit = 3): Promise<ProductCardData[]> {
  const db = getDb();
  const ordered = await db.execute<{ product_id: string; hg: string }>(sql`
    select distinct v.product_id, p.attributes ->> 'hoofdgroep_omschrijving' as hg
    from ${orderLines} ol
    join ${productVariants} v on v.sku = ol.sku
    join ${products} p on p.id = v.product_id
    where ol.order_id = ${orderId}
  `);
  if (!ordered.rows.length) return [];
  const orderedIds = ordered.rows.map((r) => r.product_id).filter(Boolean);
  const orderedCats = new Set(ordered.rows.map((r) => r.hg).filter(Boolean));
  const targets = new Set<string>();
  for (const r of ordered.rows) for (const t of CROSS_SELL[r.hg] || DEFAULT_CROSS) if (!orderedCats.has(t)) targets.add(t);
  const targetList = [...targets];
  if (!targetList.length || !orderedIds.length) return [];

  const pool = await db.execute<{ id: string; handle: string; title: string; vendor: string; hg: string }>(sql`
    select p.id, p.handle, p.title, p.vendor, p.attributes ->> 'hoofdgroep_omschrijving' as hg
    from ${products} p
    where p.status = 'active' and p.has_image = true and p.in_stock = true and p.is_group_primary = true
      and p.attributes ->> 'hoofdgroep_omschrijving' in (${sql.join(targetList.map((t) => sql`${t}`), sql`, `)})
      and p.id not in (${sql.join(orderedIds.map((i) => sql`${i}`), sql`, `)})
    order by p.source_created_at desc nulls last
    limit 40
  `);
  // Round-robin over de doelcategorieën → variatie (niet 3× dezelfde categorie/stijl).
  const byCat = new Map<string, typeof pool.rows>();
  for (const r of pool.rows) {
    if (!byCat.has(r.hg)) byCat.set(r.hg, []);
    byCat.get(r.hg)!.push(r);
  }
  const picked: typeof pool.rows = [];
  let added = true;
  while (picked.length < limit && added) {
    added = false;
    for (const t of targetList) {
      const list = byCat.get(t);
      if (list && list.length) {
        picked.push(list.shift()!);
        added = true;
        if (picked.length >= limit) break;
      }
    }
  }
  return buildProductCards(picked.map((r) => ({ id: r.id, handle: r.handle, title: r.title, vendor: r.vendor })));
}

export type SearchFacets = {
  category?: string;
  colorFamilies?: string[];
  sizeLabels?: string[];
  priceMinCents?: number;
  priceMaxCents?: number;
};

/**
 * "Bedoelde je …?" — corrigeert typefouten tegen het zoekwoorden-vocabulaire
 * (search_terms, pg_trgm). Retourneert een verbeterde query of null als er
 * niets beters is. Bewaart maten/cijfers ongewijzigd.
 */
export async function suggestCorrection(q: string): Promise<string | null> {
  const tokens = q.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!tokens.length) return null;
  const db = getDb();
  let changed = false;
  const out: string[] = [];
  for (const tok of tokens) {
    const w = tok.toLowerCase();
    if (w.length < 3 || !/^[a-z]+$/.test(w)) {
      out.push(tok);
      continue;
    }
    const exact = await db.execute(sql`select 1 from search_terms where term = ${w} limit 1`);
    if (exact.rows.length) {
      out.push(tok);
      continue;
    }
    const sug = await db.execute<{ term: string; s: number }>(
      sql`select term, similarity(term, ${w}) as s from search_terms where term % ${w} order by s desc, freq desc limit 1`
    );
    if (sug.rows[0] && Number(sug.rows[0].s) >= 0.4) {
      out.push(sug.rows[0].term);
      changed = true;
    } else {
      out.push(tok);
    }
  }
  const corrected = out.join(" ");
  return changed && corrected.toLowerCase() !== q.trim().toLowerCase() ? corrected : null;
}

/**
 * Catalogus-zoek (Doofinder-stijl): zoekt op titel/vendor/categorie MÉT
 * - maat-tokens ("overhemd 42" → alleen producten met maat 42 op voorraad),
 * - typo-tolerantie via pg_trgm (word_similarity),
 * - synoniemen (colbert=jasje, das=stropdas, broek=pantalon),
 * - facetten (categorie/kleur/maat/prijs),
 * - beschikbare maten per resultaat.
 * Raw SQL met alias p./pv. (geen drizzle-kolomref-mix in subqueries).
 */
export async function searchProducts(q: string, limit = 24, facets: SearchFacets = {}): Promise<ProductCardData[]> {
  const db = getDb();
  const raw = q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const sizeTokens = raw.filter(isSizeToken);
  const wordTokens = raw.filter((t) => !isSizeToken(t) && t.length >= 2);
  const hasFacets = Boolean(facets.category || facets.colorFamilies?.length || facets.sizeLabels?.length || facets.priceMinCents || facets.priceMaxCents);
  if (!wordTokens.length && !sizeTokens.length && !hasFacets) return [];

  // Synoniemen uit de instellingen (beheerbaar in /account/instellingen).
  const settings = await getSettings();
  const synMap = parseSynonyms(settings.searchSynonyms);

  const HAY = sql`lower(p.title || ' ' || p.vendor || ' ' || coalesce(p.attributes ->> 'hoofdgroep_omschrijving',''))`;
  const conds: SQL[] = [sql`p.status='active' and p.has_image=true and p.in_stock=true and p.is_group_primary=true`];
  const scoreParts: SQL[] = [];

  for (const tok of wordTokens) {
    const syns = expandSynonyms(tok, synMap);
    const ors: SQL[] = [];
    const scoreOrs: SQL[] = [];
    for (const s of syns) {
      ors.push(sql`${HAY} like ${"%" + s + "%"}`);
      scoreOrs.push(sql`(case when ${HAY} like ${"%" + s + "%"} then 1.0 else 0 end)`);
      if (s.length >= 4) {
        ors.push(sql`word_similarity(${s}, ${HAY}) > 0.45`);
        scoreOrs.push(sql`word_similarity(${s}, ${HAY})`);
      }
    }
    conds.push(sql`(${sql.join(ors, sql` or `)})`);
    scoreParts.push(sql`greatest(${sql.join(scoreOrs, sql`, `)})`);
  }

  for (const s of sizeTokens) {
    conds.push(sql`exists (select 1 from product_variants v where v.product_id = p.id and v.stock_qty > 0 and (lower(v.size) = ${s} or lower(v.size_label) = ${s}))`);
  }

  if (facets.category) conds.push(sql`p.attributes ->> 'hoofdgroep_omschrijving' = ${facets.category}`);
  if (facets.colorFamilies?.length)
    conds.push(sql`exists (select 1 from product_variants v where v.product_id = p.id and v.color_family in (${sql.join(facets.colorFamilies.map((c) => sql`${c}`), sql`, `)}))`);
  if (facets.sizeLabels?.length)
    conds.push(sql`exists (select 1 from product_variants v where v.product_id = p.id and v.stock_qty > 0 and v.size_label in (${sql.join(facets.sizeLabels.map((c) => sql`${c}`), sql`, `)}))`);
  if (facets.priceMinCents) conds.push(sql`exists (select 1 from product_variants v where v.product_id = p.id and v.price_cents >= ${facets.priceMinCents})`);
  if (facets.priceMaxCents) conds.push(sql`exists (select 1 from product_variants v where v.product_id = p.id and v.price_cents <= ${facets.priceMaxCents})`);

  const scoreExpr = scoreParts.length ? sql.join(scoreParts, sql` + `) : sql`0`;

  const rows = await db.execute<{ id: string; handle: string; title: string; vendor: string; sizes: string[] }>(sql`
    select p.id, p.handle, p.title, p.vendor,
      array(select distinct v.size_label from product_variants v where v.product_id = p.id and v.stock_qty > 0 and v.size_label <> '') as sizes
    from products p
    where ${sql.join(conds, sql` and `)}
    order by (${scoreExpr}) desc, p.stock_qty desc
    limit ${limit}
  `);

  const cards = await buildProductCards(rows.rows.map((r) => ({ id: r.id, handle: r.handle, title: r.title, vendor: r.vendor })));
  const sizesById = new Map(rows.rows.map((r) => [r.id, r.sizes || []]));
  return cards.map((c) => ({
    ...c,
    availableSizes: [...new Set(sizesById.get(c.id) || [])].sort((a, b) => rowSortIndex(a) - rowSortIndex(b)),
  }));
}

/**
 * Een "highlight"-strip voor de homepage: producten uit een hoofdgroep met
 * beeld, gesorteerd op nieuwste eerst. Voor "nieuw binnen" en categorie-strips.
 */
export async function getHighlights(category: string, limit = 4): Promise<ProductCardData[]> {
  const db = getDb();
  const rows = await db.execute<{ id: string; handle: string; title: string; vendor: string }>(sql`
    select p.id, p.handle, p.title, p.vendor
    from ${products} p
    where p.status = 'active' and p.has_image = true and p.in_stock = true and p.is_group_primary = true
      and p.attributes ->> 'hoofdgroep_omschrijving' = ${category}
    order by p.source_created_at desc nulls last
    limit ${limit}
  `);
  return buildProductCards(rows.rows.map((r) => ({ id: r.id, handle: r.handle, title: r.title, vendor: r.vendor })));
}

export type VariantSibling = {
  handle: string;
  colorLabel: string;
  imageUrl: string;
  inStock: boolean;
  isCurrent: boolean;
};

/**
 * Kleurvarianten van een product (zelfde variantGroupKey). Geeft alle kleuren
 * terug — ook het huidige product — met eerste foto en voorraadstatus, zodat de
 * PDP duidelijke kleurkeuze-swatches kan tonen. Leeg als er geen groep is.
 */
export async function getVariantSiblings(groupKey: string, currentHandle: string): Promise<VariantSibling[]> {
  if (!groupKey) return [];
  const db = getDb();
  const rows = await db.execute<{ handle: string; label: string; in_stock: boolean; url: string | null }>(sql`
    select p.handle, p.variant_color_label as label, p.in_stock,
      (select pi.url from ${productImages} pi where pi.product_id = p.id order by pi.position asc limit 1) as url
    from ${products} p
    where p.variant_group_key = ${groupKey} and p.status = 'active' and p.has_image = true
    order by p.in_stock desc, p.variant_color_label asc
  `);
  return rows.rows.map((r) => ({
    handle: r.handle,
    colorLabel: r.label || "Variant",
    imageUrl: r.url || "",
    inStock: r.in_stock,
    isCurrent: r.handle === currentHandle,
  }));
}

/** Lijst van categorieën (hoofdgroep) met telling — voor nav/landing. */
export async function listCategories(): Promise<{ name: string; count: number }[]> {
  const db = getDb();
  const rows = await db.execute<{ name: string; n: number }>(sql`
    select attributes ->> 'hoofdgroep_omschrijving' as name, count(*)::int as n
    from ${products}
    where status = 'active' and has_image = true and in_stock = true and is_group_primary = true
      and attributes ->> 'hoofdgroep_omschrijving' is not null
    group by 1 order by n desc`);
  return rows.rows.map((r) => ({ name: r.name, count: r.n }));
}
