import { getReferencePrices, isRealDiscount } from "@/lib/pricing";
import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { cache } from "react";
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
import { buildRegelScore, type MerchRegel } from "@/lib/merchandising-regels";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getLocale } from "@/lib/locale-server";
import { COLOR_FAMILIES, type ColorFamily } from "@/lib/colors";
import { NEW_COLLECTION_HANDLE } from "@/lib/new-collection";
import { colorIsArticle } from "@/lib/variant-grouping";
import { crossSellDoelen, isFormeel, FORMELE_KLEUREN } from "@/lib/cross-sell-regels";
import { mySizeBuckets } from "@/lib/size-match";
import {
  rowSortIndex,
  rowDisplayLabel,
  sizeToken,
  sizeFacetFor,
  sizeFacetKey,
  sizeFilterBranches,
  compareSizeValues,
  SIZE_SYSTEM_ORDER,
  SIZE_FAMILY_NAMES,
  SIZE_FAMILY_TITLE_PATTERNS,
  CLOTHING_ROW_PAIRS,
  type SizeSystem,
} from "@/lib/size-taxonomy";
import { MATERIAL_BUCKETS, PATTERN_BUCKETS, bucketsFor, sqlPatternFor, normalizeType, expandType, LOOSE_MIN_COUNT, type FacetBucket } from "@/lib/facet-taxonomy";
import { isSizeToken, expandSynonyms, parseSynonyms } from "@/lib/search-helpers";
import { getSettings } from "@/lib/settings";

/**
 * HET zichtbaarheidscriterium van de winkel, als SQL-fragment op tabel-alias `p`.
 * Rapportages die "staat dit online?" naast de catalogus leggen (beeldstatus,
 * eigen-beeld, dubbele-skus) moeten dít gebruiken — een hand-gekopieerde variant
 * gaat stil uit de pas lopen zodra hier een voorwaarde bij komt, en dan liegt
 * het rapport precies op het punt waarvoor het bestaat.
 * (De query-builder-condities verderop in dit bestand zeggen inhoudelijk
 * hetzelfde; bij een wijziging horen beide tegelijk aangepast te worden.)
 */
export const OP_WEBSITE_SQL = "p.status = 'active' and p.has_image and p.in_stock and p.is_group_primary";

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
  /**
   * Omnibus-referentieprijs ("van"-prijs) van dezelfde variant die de PDP bij het
   * openen toont — alleen gevuld als er een ECHTE korting is (isRealDiscount).
   * Bewust NIET het Shopify-veld compareAtCents: dat is een vrij invulbaar
   * marketingveld en leverde kaarten op die korting beloofden die de PDP niet gaf.
   */
  referenceCents?: number;
  /** Aantal kleuren in de variantgroep (≥2 → toon "+N kleuren" op de kaart). */
  colorCount?: number;
  /** Lage voorraad → eerlijke schaarste-badge ("Laatste exemplaren"). */
  lowStock?: boolean;
  /** Beschikbare maten (op voorraad) — gevuld in zoekresultaten. */
  availableSizes?: string[];
  /** Hoofdgroep/categorie — voor zoek-facetten. */
  category?: string;
};

/**
 * Technische app-collecties uit Shopify (XCloud Search, filter-index, ChatGPT-
 * beschrijvingen): geen klant-content. Uit de lijsten/sitemap houden en op de
 * PLP niet laten indexeren — de handle blijft wel direct bereikbaar.
 */
export function isTechnicalCollection(c: { handle: string; title: string }): boolean {
  return (
    /\[|\bapp\b|all products|do.?not.?delete/i.test(c.title) ||
    /^(cloud-search|xcloud|smart-products-filter|all-products-)/.test(c.handle)
  );
}

export async function listCollections() {
  const db = getDb();
  const rows = await db
    .select({
      id: collections.id,
      handle: collections.handle,
      title: collections.title,
      descriptionHtml: collections.descriptionHtml,
    })
    .from(collections)
    .orderBy(asc(collections.position), asc(collections.title));
  return rows.filter((c) => !isTechnicalCollection(c));
}

// React.cache: een collectie-PLP haalt dit 2× per request op (page + generateMetadata);
// dedup binnen de request scheelt een dubbele query.
export const getCollectionByHandle = cache(async (handle: string) => {
  const db = getDb();
  const rows = await db.select().from(collections).where(eq(collections.handle, handle)).limit(1);
  return rows[0] ?? null;
});

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

  const [images, variants, prodMeta, kleurTelling] = await Promise.all([
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
        id: productVariants.id,
        productId: productVariants.productId,
        priceCents: productVariants.priceCents,
      })
      .from(productVariants)
      .where(inArray(productVariants.productId, ids))
      // Positie-volgorde: de PDP kiest de EERSTE variant met de laagste prijs;
      // de kaart moet exact diezelfde variant pakken, anders wijkt de "van"-prijs af.
      .orderBy(asc(productVariants.position)),
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
    // Hoeveel kleuren de klant hier ÉCHT kan kiezen. De opgeslagen
    // group_color_count telt alle groepsleden, ook die zonder foto (en dus nooit
    // toonbaar) en ook dubbele invoer met dezelfde kleurnaam. Daardoor beloofde
    // een kaartje "In 3 kleuren" terwijl er op de productpagina niets te kiezen
    // viel. Daarom hier tellen wat er werkelijk staat: verschillende kleurnamen
    // onder de leden die actief zijn, een foto hebben en op voorraad liggen.
    db.execute<{ id: string; n: number }>(sql`
      select p.id, count(distinct lower(s.variant_color_label))::int as n
      from products p
      join products s on s.variant_group_key = p.variant_group_key
      where p.id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        and coalesce(p.variant_group_key, '') <> ''
        and s.status = 'active' and s.has_image = true and s.in_stock = true
        and coalesce(s.variant_color_label, '') <> ''
      group by p.id
    `),
  ]);

  const colorCount = new Map<string, number>(kleurTelling.rows.map((r) => [r.id, Number(r.n) || 0]));
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
  // Goedkoopste variant per product — dezelfde die de PDP als startprijs toont.
  const cheapestVariant = new Map<string, { id: string; priceCents: number }>();
  for (const v of variants) {
    const range = priceRange.get(v.productId);
    if (!range) priceRange.set(v.productId, { min: v.priceCents, max: v.priceCents });
    else {
      range.min = Math.min(range.min, v.priceCents);
      range.max = Math.max(range.max, v.priceCents);
    }
    const cheap = cheapestVariant.get(v.productId);
    // Strikt kleiner: bij gelijke prijs wint de eerste in positie-volgorde (= PDP-keuze).
    if (!cheap || v.priceCents < cheap.priceCents) cheapestVariant.set(v.productId, { id: v.id, priceCents: v.priceCents });
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

  // Kortingswaarheid = die van de PDP: de Omnibus-referentieprijs uit de eigen
  // prijshistorie (lib/pricing), niet het vrij invulbare Shopify-veld compareAt.
  // Eén gebatchte query voor de hele lijst (alleen de goedkoopste variant per
  // product, dus ~1 id per kaart) en meteen in de Promise.all naast het
  // vertaalwerk — zo kost het geen extra round-trip, en is er geen moment waarop
  // de promise zonder handler kan afketsen (unhandled rejection).
  const [referencePrices, titleTl] = await Promise.all([
    getReferencePrices([...cheapestVariant.values()].map((v) => v.id)),
    // Vertaalde titels voor niet-NL locale (AI-vertaling, product_translations).
    (async () => {
      const map = new Map<string, string>();
      const locale = await getLocale();
      if (locale === DEFAULT_LOCALE) return map;
      const tls = await db
        .select({ productId: productTranslations.productId, title: productTranslations.title })
        .from(productTranslations)
        .where(and(inArray(productTranslations.productId, ids), eq(productTranslations.locale, locale)));
      for (const t of tls) if (t.title) map.set(t.productId, t.title);
      return map;
    })(),
  ]);

  // Alleen een "van"-prijs als de drempel gehaald wordt (isRealDiscount: ≥5% én ≥€1),
  // exact zoals de buy-box op de PDP. Geen referentieprijs → geen doorstreping,
  // geen sale-badge. Beide velden komen uit dezelfde bron, dus ze kunnen niet
  // meer uit elkaar lopen.
  const saleRefCents = new Map<string, number>();
  for (const [productId, v] of cheapestVariant) {
    const ref = referencePrices.get(v.id);
    if (isRealDiscount(v.priceCents, ref)) saleRefCents.set(productId, ref!);
  }

  const cards = base.map((p) => {
    const img = firstImage.get(p.id);
    const range = priceRange.get(p.id);
    const rawAlt = (img?.alt || "").trim();
    const cleanAlt = !rawAlt || isEnglishish(rawAlt) ? p.title : rawAlt;
    const tl = titleTl.get(p.id);
    // Bij een kleurgroep tonen we de BASISnaam op de kaart (kleur weg uit titel),
    // zodat "Stropdas PE lichtblauw" → "Stropdas PE · In 19 kleuren".
    // Behalve waar de kleur HET artikel is (pochet/das/strik): daar staat elke
    // kleur als eigen kaart in het overzicht, en zouden 19 kaarten allemaal
    // "Pochet PE · In 19 kleuren" heten. Kleur in de titel, geen telling.
    const kleurIsArtikel = colorIsArticle(categoryById.get(p.id) || "");
    const cnt = kleurIsArtikel ? 1 : colorCount.get(p.id) ?? 1;
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
      hasSale: saleRefCents.has(p.id),
      referenceCents: saleRefCents.get(p.id),
      colorCount: cnt,
      lowStock: (() => {
        const q = stockQtyById.get(p.id) ?? 0;
        return q > 0 && q <= 5;
      })(),
      category: categoryById.get(p.id) || "",
    };
  });
  return cards;
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

// React.cache: dedupliceert de aanroep binnen één request. De PDP haalt het product
// zowel in generateMetadata als in de page op — zonder dit zijn dat 2× ~5 queries.
// Request-scoped (geen cross-request cache, geen serialisatie) → altijd verse data.
export const getProductByHandle = cache(async (handle: string) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.handle, handle), eq(products.status, "active")))
    .limit(1);
  let product = rows[0];
  if (!product) return null;

  // SEO/i18n: op /en /de /fr /es de vertaalde titel + omschrijving uit
  // product_translations gebruiken — die stromen zo door naar de PDP-kop,
  // meta-tags en JSON-LD. getLocale is fail-safe (scripts → NL pass-through).
  const locale = await getLocale();
  if (locale !== DEFAULT_LOCALE) {
    const [tl] = await db
      .select({ title: productTranslations.title, descriptionHtml: productTranslations.descriptionHtml })
      .from(productTranslations)
      .where(and(eq(productTranslations.productId, product.id), eq(productTranslations.locale, locale)))
      .limit(1);
    if (tl) {
      product = {
        ...product,
        title: tl.title || product.title,
        descriptionHtml: tl.descriptionHtml || product.descriptionHtml,
      };
    }
  }

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
});

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
  /** Merchandising-regels die nú gelden voor deze PLP (getActieveRegels). */
  regels?: MerchRegel[];
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
  // label = zichtbare (vertaalde) tekst; value blijft de NL-bronwaarde die in
  // de URL/filterlogica staat — zie lib/facet-i18n.
  materials: { value: string; label?: string; count: number }[];
  patterns: { value: string; label?: string; count: number }[];
  seasons: { value: string; label?: string; count: number }[];
  ironFreeCount: number;
  colors: { key: ColorFamily; label: string; hex: string; count: number }[];
  /**
   * Maten met hun matensysteem: `value` draagt het systeem mee (`sc.41` =
   * schoenmaat 41, `bo.41` = boordmaat 41), `label` is wat de klant ziet.
   * Gesorteerd op systeem (SIZE_SYSTEM_ORDER) en daarbinnen op maat.
   */
  sizes: { value: string; label: string; count: number; system: SizeSystem }[];
  fits: { value: string; label?: string; count: number }[];
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

/* ─────────────────────── Maat: systeem uit het product ────────────────────
 *
 * Schoenmaat 41 en overhemd-boordmaat 41 zijn hetzelfde getal maar een heel
 * andere maat. Welk matensysteem geldt, leest het PRODUCT ons voor: de
 * hoofdgroep. Alleen als die leeg is (losse Shopify-producten zonder
 * SRS-velden) vallen we terug op de titel. Zie lib/size-taxonomy.
 */
const SIZE_FAM_SQL: SQL = sql`(case
  when coalesce(${products.attributes} ->> 'hoofdgroep_omschrijving', '') <> ''
    then lower(${products.attributes} ->> 'hoofdgroep_omschrijving')
  ${sql.join(
    SIZE_FAMILY_TITLE_PATTERNS.map(
      (p) => sql`when (${products.title} || ' ' || coalesce(${products.attributes} ->> 'title_tag', '')) ~* ${p.sql} then ${p.family}::text`
    ),
    sql` `
  )}
  else '' end)`;

/** Maat-token van een variant: eerste woord, hoofdletters ("L 41/42" → "L"). */
const SIZE_TOKEN_SQL: SQL = sql`upper(split_part(btrim(coalesce(nullif(v.size, ''), v.size_label, '')), ' ', 1))`;

/**
 * Token → lettermaat-rij als VALUES-lijst, uitsluitend om de TELLING te
 * ontdubbelen: een pantalon met maat 52 (regular) én 102 (lang) staat één keer
 * in de rij "L". De indeling zelf gebeurt in TS (sizeFacetFor) — dit is puur
 * een groepeersleutel.
 */
const SIZE_ROWMAP_SQL: SQL = sql`(values ${sql.join(
  CLOTHING_ROW_PAIRS.map(([tok, row]) => sql`(${tok}::text, ${row}::text)`),
  sql`, `
)}) rm(tok, row)`;

function famClassCondition(famClass: string): SQL | null {
  if (famClass === "alle") return null;
  if (famClass === "rest") {
    const alle = Object.values(SIZE_FAMILY_NAMES).flat();
    return sql`${SIZE_FAM_SQL} not in (${sqlInList(alle)})`;
  }
  const namen = SIZE_FAMILY_NAMES[famClass as keyof typeof SIZE_FAMILY_NAMES] ?? [];
  return sql`${SIZE_FAM_SQL} in (${sqlInList(namen)})`;
}

/**
 * Filterconditie voor de gekozen maten (binnen de variant-EXISTS).
 *
 * Nieuwe waarden dragen hun systeem mee (`sc.41`) en filteren dus óók op de
 * productfamilie. Een KALE waarde (`maat=41`, `maat=M/L`) is een oude,
 * gedeelde of gebookmarkte link: die laten we bewust alles met die maat zien —
 * over alle systemen heen — zodat er geen dode links ontstaan.
 */
function sizeCondition(values: string[]): SQL {
  const ors: SQL[] = [];
  for (const value of values) {
    const branches = sizeFilterBranches(value);
    if (!branches) {
      ors.push(sql`(v.size_label = ${value} or ${SIZE_TOKEN_SQL} = ${sizeToken(value)})`);
      continue;
    }
    for (const b of branches) {
      const tokens = b.tokens.length === 1
        ? sql`${SIZE_TOKEN_SQL} = ${b.tokens[0]}`
        : sql`${SIZE_TOKEN_SQL} in (${sqlInList(b.tokens)})`;
      const fam = famClassCondition(b.famClass);
      ors.push(fam ? sql`(${fam} and ${tokens})` : tokens);
    }
  }
  // Geen enkele bruikbare waarde → niets tonen (de klant vroeg wél om een maat).
  return ors.length ? sql`(${sql.join(ors, sql` or `)})` : sql`false`;
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
    parts.push(sizeCondition(f.sizes));
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
    // Samengevoegde types meenemen: "Pakken" moet ook "Pakken Modern Fit" vinden.
    const expanded = [...new Set(f.types.flatMap((v) => expandType(v)))];
    conds.push(inList(sql`${products.attributes} ->> 'subgroep'`, expanded));
  }
  if (f.materials?.length) {
    conds.push(bucketCondition(sql`${products.attributes} ->> 'materiaal'`, f.materials, MATERIAL_BUCKETS));
  }
  if (f.patterns?.length) {
    // "Effen" = geen/leeg dessin; combineer met eventuele echte dessins via OR.
    const real = f.patterns.filter((p) => p !== "Effen");
    const ors: SQL[] = [];
    if (real.length) ors.push(bucketCondition(sql`${products.attributes} ->> 'print_design'`, real, PATTERN_BUCKETS));
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

/**
 * Versheid = collectiejaar, met de aanmaakdatum als terugval.
 *
 * `source_created_at` is de aanmaakdatum van het Shopify-record uit de migratie,
 * niet het moment dat het artikel echt nieuw was. Binnen de New arrivals-collectie
 * (alles jaar=2026) loopt die datum van maart 2024 tot juni 2026, puur afhankelijk
 * van of een artikel in de migratiebatch zat. Op "Nieuwste" zakten daardoor echte
 * artikelen uit de nieuwe collectie naar de laatste pagina.
 *
 * SRS' `jaar` is het signaal dat de merchandiser zelf onderhoudt en dat 1-op-1
 * samenvalt met de New arrivals-collectie. Het is tekst en bevat ook "NOS", dus:
 * cijfers eruit filteren, casten, en bij géén jaartal terugvallen op het jaar van
 * de aanmaakdatum — zo zakt een artikel zonder jaar niet naar de bodem.
 */
const VERSHEID = sql`coalesce(
  nullif(regexp_replace(coalesce(${products.attributes} ->> 'jaar', ''), '\\D', '', 'g'), '')::int,
  extract(year from ${products.sourceCreatedAt})::int
)`;

/**
 * Stabiele staart. Zonder unieke laatste sleutel mag Postgres rijen met gelijke
 * sorteerwaarde per query in een andere volgorde teruggeven — en dat gebeurt hier
 * ook: tot 10 producten delen exact dezelfde `source_created_at` (importbatches).
 * Met LIMIT/OFFSET betekent dat een product dat op pagina 2 én 3 opduikt, of
 * helemaal wegvalt. `id` breekt elke gelijkstand definitief.
 */
const STABIEL = sql`${products.id} desc`;

/** Objectieve sorteringen (los van personalisatie). */
const SORT_ORDER: Record<"nieuw" | "prijs-op" | "prijs-af" | "naam", SQL> = {
  nieuw: sql`${VERSHEID} desc nulls last, ${products.sourceCreatedAt} desc nulls last, ${STABIEL}`,
  "prijs-op": sql`mp asc nulls last, ${STABIEL}`,
  "prijs-af": sql`mp desc nulls last, ${STABIEL}`,
  naam: sql`${products.title} asc, ${STABIEL}`,
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
  const tail = sql`${products.stockQty} desc nulls last, ${VERSHEID} desc nulls last, ${products.sourceCreatedAt} desc nulls last, ${STABIEL}`;

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
  // Merchandising-regels: één opgetelde score (omhoog +, omlaag −), boven de
  // populariteit. Geen regels → letterlijk dezelfde ORDER BY als hiervoor.
  const regelScore = buildRegelScore(ctx?.regels ?? []);
  const regelBoost = regelScore ? sql`${regelScore} desc, ` : sql``;

  return {
    order: sql`${pinBoost}${mySizeBoost}${regelBoost}${popScore} desc, ${tasteBoost}${breadth} desc, ${tail}`,
    usesPop: true,
  };
}

/**
 * Populariteits-scores per handle (view=1, add_to_cart=3) over het venster.
 * Losgetrokken uit de PLP-query zodat 'ie cross-request gecachet kan worden:
 * de aggregatie over de events-tabel groeit met traffic en draaide voorheen
 * bij ELKE PLP-hit (aanbevolen/populair is de default-sort). Top-500 volstaat:
 * daaronder is de score ~0 en beslissen de tie-breakers (voorraad/versheid).
 */
async function getPopularityScoresUncached(popDays: number): Promise<{ handle: string; score: number }[]> {
  const db = getDb();
  // Twee bronnen bij elkaar: gedrag op de site (events) én wat er daadwerkelijk
  // verkocht is (order_lines). Dat tweede is cruciaal — de webshop heeft
  // duizenden betaalde orders maar pas sinds kort volledige event-meting, dus
  // zonder verkoopdata zou "populair" nog maanden op bijna niets draaien.
  // Verkoop weegt zwaar (8/stuk): het is het enige signaal dat écht telt.
  const res = await db.execute<{ handle: string; score: number }>(sql`
    with gedrag as (
      select handle, sum(case
               when type='add_to_cart' then 3
               when type='wishlist_add' then 2
               when type='product_click' then 1
               when type='product_view' then 1
               else 0 end)::int as score
      from ${events}
      where handle <> ''
        and type in ('product_view','product_click','add_to_cart','wishlist_add')
        and created_at > now() - (${popDays} || ' days')::interval
      group by handle
    ),
    verkocht as (
      select l.product_handle as handle, (sum(l.quantity) * 8)::int as score
      from ${orderLines} l
      join ${orders} o on o.id = l.order_id
      where o.status in ('paid','shipped','ready_pickup','delivered')
        -- Verkoop krijgt een RUIMER venster dan klikgedrag: een klik veroudert
        -- snel, maar "dit verkocht goed" blijft maanden relevant — en met het
        -- huidige webshop-volume zou 30 dagen bijna niets opleveren.
        and o.created_at > now() - (${popDays * 6} || ' days')::interval
        and coalesce(l.product_handle, '') <> ''
      group by l.product_handle
    )
    select handle, sum(score)::int as score from (
      select handle, score from gedrag
      union all select handle, score from verkocht
    ) samen
    group by handle
    order by score desc
    limit 500
  `);
  return res.rows.map((r) => ({ handle: r.handle, score: Number(r.score) || 0 }));
}
// Zelfde cache-profiel als _facetsCached: gedeeld door álle bezoekers, 3 min vers.
const _popularityCached = unstable_cache(
  (popDays: number) => getPopularityScoresUncached(popDays),
  ["plp-popularity-v4"],
  { revalidate: 180 },
);

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
  // Populariteit: gecachte top-scores (3 min, cross-request) als VALUES-CTE in de
  // query geïnjecteerd i.p.v. de events-aggregatie per request te draaien. De join
  // + coalesce(pop.score, 0) blijven identiek; een lege lijst → lege CTE (zelfde
  // 0-score-gedrag). Alleen voor aanbevolen/populair; overige sorts blijven licht.
  const popDays = Math.max(1, Math.floor(ctx?.popularityDays ?? 30));
  const popRows = usesPop ? await _popularityCached(popDays) : [];
  const withPop = usesPop
    ? (popRows.length
        ? sql`with pop(handle, score) as (values ${sql.join(popRows.map((r) => sql`(${r.handle}, ${r.score}::int)`), sql`, `)}) `
        : sql`with pop(handle, score) as (select ''::text, 0::int where false) `)
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

/**
 * Filterconditie voor een gebucket facet: bekende bucket → patroonmatch (zodat
 * "Wol" ook "Polyester wol" vindt), onbekende waarde → exacte match zodat oude
 * gedeelde filterlinks blijven werken.
 */
function bucketCondition(col: SQL, values: string[], buckets: FacetBucket[]): SQL {
  const ors: SQL[] = [];
  const exact: string[] = [];
  for (const v of values) {
    const pattern = sqlPatternFor(v, buckets);
    if (pattern) ors.push(sql`${col} ~* ${pattern}`);
    else exact.push(v);
  }
  if (exact.length) ors.push(inList(col, exact));
  return ors.length ? sql`(${sql.join(ors, sql` or `)})` : sql`true`;
}

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
    // `fam` = de productfamilie die het matensysteem bepaalt; `tok` = de rauwe
    // maat (eerste woord). Bewust NIET op het opgeslagen size_label groeperen:
    // dat collapst schoenmaat 46 naar "S" en boordmaat 41 naar "L".
    db.execute<{ facet: string; v: string | null; fam: string | null; n: number }>(sql`
      with ctxv as materialized (
        select ${products.id} as id, v.color_family, v.stock_qty, v.price_cents,
               ${SIZE_FAM_SQL} as fam, ${SIZE_TOKEN_SQL} as tok
        from ${products} join ${productVariants} v on v.product_id = ${products.id}
        where ${ctx}
      )
      select 'color' as facet, color_family as v, ''::text as fam, count(distinct id)::int as n from ctxv where color_family <> '' and stock_qty > 0 group by color_family
      union all select 'size', min(c.tok), c.fam, count(distinct c.id)::int
        from ctxv c left join ${SIZE_ROWMAP_SQL} on rm.tok = c.tok
        where c.tok <> '' and c.stock_qty > 0
        -- Groeperen op de lettermaat-rij ontdubbelt regular/long/short; de
        -- cijfer-vlag houdt boordmaat 44 los van lettermaat XS bij overhemden.
        group by c.fam, coalesce(rm.row, c.tok), (c.tok ~ '^[0-9]')
      union all select 'price_lo', ''::text, ''::text, coalesce(min(price_cents),0)::int from ctxv
      union all select 'price_hi', ''::text, ''::text, coalesce(max(price_cents),0)::int from ctxv
    `),
  ]);

  const pRows = prodAgg.rows, vRows = varAgg.rows;
  const of = (rows: typeof pRows, facet: string) => rows.filter((r) => r.facet === facet);
  const scalar = (rows: typeof pRows, facet: string) => Number(of(rows, facet)[0]?.n ?? 0);

  const colorCount = new Map(of(vRows, "color").map((r) => [r.v ?? "", r.n]));
  const colors = COLOR_FAMILIES.filter((c) => colorCount.has(c.key)).map((c) => ({ ...c, count: colorCount.get(c.key) ?? 0 }));

  // Maten per MATENSYSTEEM (kleding / boordmaat / schoen / riem / …). Het
  // systeem komt uit het product, niet uit het getal — anders levert filteren
  // op "41" overhemden mét schoenen op.
  const sizeAcc = new Map<string, { system: SizeSystem; value: string; count: number }>();
  for (const r of vRows.filter((x) => x.facet === "size")) {
    const hit = sizeFacetFor(r.fam ?? "", r.v ?? "");
    if (!hit) continue;
    const key = sizeFacetKey(hit);
    const cur = sizeAcc.get(key);
    // Optellen over families/tokens die op dezelfde facet-waarde uitkomen
    // (bv. colbert 48 en trui M → beide "kleding · M").
    if (cur) cur.count += r.n;
    else sizeAcc.set(key, { system: hit.system, value: hit.value, count: r.n });
  }
  const sizes = [...sizeAcc]
    .sort(
      ([, a], [, b]) =>
        SIZE_SYSTEM_ORDER.indexOf(a.system) - SIZE_SYSTEM_ORDER.indexOf(b.system) ||
        compareSizeValues(a.value, b.value)
    )
    .map(([key, x]) => ({ value: key, label: rowDisplayLabel(x.value), count: x.count, system: x.system }));

  const fits = of(pRows, "pasvorm").map((r) => ({ value: r.v ?? "", count: r.n })).sort((a, b) => b.count - a.count);

  // Type: interne codes eruit, pasvorm-varianten samengevoegd (Pakken Modern
  // Fit → Pakken); tellingen van samengevoegde waarden optellen.
  const typeCount = new Map<string, number>();
  for (const r of of(pRows, "subgroep")) {
    const norm = normalizeType(r.v ?? "");
    if (norm) typeCount.set(norm, (typeCount.get(norm) ?? 0) + r.n);
  }
  const types = [...typeCount].map(([value, count]) => ({ value, label: typeLabel(value), count })).sort((a, b) => b.count - a.count);

  // Materiaal + dessin op HOOFDCOMPONENT (lib/facet-taxonomy): "Polyester
  // viscose" viel eerst als eigen filter naast "Katoen"; wie op wol zocht miste
  // elke wolmix. Eén product kan in meerdere buckets vallen.
  const bucketed = (facet: string, buckets: typeof MATERIAL_BUCKETS) => {
    const acc = new Map<string, number>();
    for (const r of of(pRows, facet)) {
      for (const key of bucketsFor(r.v ?? "", buckets)) acc.set(key, (acc.get(key) ?? 0) + r.n);
    }
    const bucketKeys = new Set(buckets.map((b) => b.key));
    return [...acc]
      .map(([value, count]) => ({ value, count }))
      // Bucket-waarden vanaf 2; losse rest-waarden pas vanaf LOOSE_MIN_COUNT.
      .filter((x) => (bucketKeys.has(x.value) ? x.count >= 2 : x.count >= LOOSE_MIN_COUNT))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  };
  const materials = bucketed("materiaal", MATERIAL_BUCKETS);

  // Seizoen: alleen echte seizoenen (geen "NOS"/"Black friday"-ruis).
  const seasons = of(pRows, "seizoen").filter((r) => REAL_SEASONS.has(r.v ?? "")).map((r) => ({ value: r.v ?? "", count: r.n })).sort((a, b) => b.count - a.count);

  // "Effen" (geen dessin) als eerste optie — meestal de grootste groep.
  const effenCount = scalar(pRows, "effen");
  const patterns = [
    ...(effenCount >= 2 ? [{ value: "Effen", count: effenCount }] : []),
    ...bucketed("print_design", PATTERN_BUCKETS),
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
  // v4: boordmaten lezen nu uit de boordreeks (44 = hals XL, niet pakmaat XS).
  ["plp-facets-v4"],
  { revalidate: 180 },
);
export function getFacets(f: ProductFilters): Promise<Facets> {
  return _facetsCached(f.collectionId || "", f.category || "");
}

/* ─────────────────────────── Bijverkoop / cross-sell ──────────────────── */

/**
 * Aanbevelingen om "de look compleet te maken": producten uit complementaire
 * categorieën, met afbeelding, gebalanceerd over de doelcategorieën.
 *
 * `subgroep` + `attrs` bepalen mee wát er past: bij een LAKSCHOEN werden een riem
 * en turquoise sokken aangeboden, omdat alleen de hoofdgroep "Schoenen" telde.
 * Bij black tie hoort geen riem en geen vrolijke kleur — zie lib/cross-sell-regels.
 */
export async function getRecommendations(
  hoofdgroep: string,
  excludeProductId: string | null,
  limit = 4,
  opts: { subgroep?: string; attrs?: Record<string, unknown> } = {}
): Promise<ProductCardData[]> {
  const db = getDb();
  const attrs = opts.attrs ?? {};
  const subgroep = opts.subgroep ?? String(attrs.subgroep ?? "");
  const targets = crossSellDoelen(hoofdgroep, subgroep, attrs);
  const exclude = excludeProductId || "00000000-0000-0000-0000-000000000000";
  // Formeel artikel → alleen sobere kleuren, behalve bij artikelen die zélf voor
  // die gelegenheid zijn (een smokingoverhemd of strik is per definitie goed).
  const formeel = isFormeel(hoofdgroep, subgroep, attrs);
  const kleurCond = formeel
    ? sql` and (
        p.attributes ->> 'subgroep' in ('Smoking','Rokkostuum')
        or exists (
          select 1 from ${productVariants} v
          where v.product_id = p.id and v.stock_qty > 0
            and v.color_family in (${sql.join(FORMELE_KLEUREN.map((c: string) => sql`${c}`), sql`, `)})
        )
      )`
    : sql``;

  const rows = await db.execute<{ id: string; handle: string; title: string; vendor: string; hg: string }>(sql`
    select p.id, p.handle, p.title, p.vendor, p.attributes ->> 'hoofdgroep_omschrijving' as hg
    from ${products} p
    where p.status = 'active' and p.has_image = true and p.in_stock = true and p.is_group_primary = true
      and p.attributes ->> 'hoofdgroep_omschrijving' in (${sql.join(targets.map((t) => sql`${t}`), sql`, `)})
      and p.id <> ${exclude}${kleurCond}
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
  const ordered = await db.execute<{ product_id: string; hg: string; sg: string; attrs: Record<string, unknown> }>(sql`
    select distinct v.product_id, p.attributes ->> 'hoofdgroep_omschrijving' as hg,
           coalesce(p.attributes ->> 'subgroep','') as sg, p.attributes as attrs
    from ${orderLines} ol
    join ${productVariants} v on v.sku = ol.sku
    join ${products} p on p.id = v.product_id
    where ol.order_id = ${orderId}
  `);
  if (!ordered.rows.length) return [];
  const orderedIds = ordered.rows.map((r) => r.product_id).filter(Boolean);
  const orderedCats = new Set(ordered.rows.map((r) => r.hg).filter(Boolean));
  const targets = new Set<string>();
  // Zelfde regels als op de productpagina — wie een smoking bestelde krijgt in de
  // bevestigingsmail geen riem aangeboden.
  for (const r of ordered.rows) {
    for (const t of crossSellDoelen(r.hg, r.sg, r.attrs ?? {})) if (!orderedCats.has(t)) targets.add(t);
  }
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
