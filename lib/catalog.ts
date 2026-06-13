import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import {
  products,
  productVariants,
  productImages,
  productCollections,
  collections,
} from "@/db/schema";
import { COLOR_FAMILIES, type ColorFamily } from "@/lib/colors";
import { rowSortIndex, rowDisplayLabel } from "@/lib/size-taxonomy";

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
  minPriceCents: number;
  hasPriceRange: boolean;
  isNew?: boolean;
  hasSale?: boolean;
  /** Hoogste compareAt-prijs voor de variant die nu op sale is — voor doorstrepen. */
  compareAtCents?: number;
  /** Aantal kleuren in de variantgroep (≥2 → toon "+N kleuren" op de kaart). */
  colorCount?: number;
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
      })
      .from(products)
      .where(inArray(products.id, ids)),
  ]);

  const colorCount = new Map(prodMeta.map((m) => [m.id, m.groupColorCount]));
  const colorLabel = new Map(prodMeta.map((m) => [m.id, m.variantColorLabel]));

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

  return base.map((p) => {
    const img = firstImage.get(p.id);
    const range = priceRange.get(p.id);
    const rawAlt = (img?.alt || "").trim();
    const cleanAlt = !rawAlt || isEnglishish(rawAlt) ? p.title : rawAlt;
    // Bij een kleurgroep tonen we de BASISnaam op de kaart (kleur weg uit titel),
    // zodat "Stropdas PE lichtblauw" → "Stropdas PE · In 19 kleuren".
    const cnt = colorCount.get(p.id) ?? 1;
    const lbl = (colorLabel.get(p.id) || "").trim();
    let displayTitle = p.title;
    if (cnt > 1 && lbl && p.title.toLowerCase().endsWith(lbl.toLowerCase())) {
      displayTitle = p.title.slice(0, p.title.length - lbl.length).replace(/[\s,–-]+$/, "").trim() || p.title;
    }
    return {
      id: p.id,
      handle: p.handle,
      title: displayTitle,
      vendor: p.vendor,
      imageUrl: img?.url || "",
      imageAlt: cleanAlt,
      minPriceCents: range?.min ?? 0,
      hasPriceRange: Boolean(range && range.min !== range.max),
      isNew: newFlag.get(p.id) ?? false,
      hasSale: onSale.get(p.id) ?? false,
      compareAtCents: compareAtBest.get(p.id),
      colorCount: colorCount.get(p.id) ?? 1,
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

  const [variants, images, links] = await Promise.all([
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
  ]);

  return { product, variants, images, collections: links };
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

export type ProductSort = "nieuw" | "prijs-op" | "prijs-af" | "naam";

export type ProductFilters = {
  collectionId?: string;
  category?: string; // hoofdgroep_omschrijving
  colorFamilies?: string[];
  sizes?: string[];
  fits?: string[];
  priceMinCents?: number;
  priceMaxCents?: number;
};

export type Facets = {
  colors: { key: ColorFamily; label: string; hex: string; count: number }[];
  sizes: { value: string; label: string; count: number }[];
  fits: { value: string; count: number }[];
  priceMinCents: number;
  priceMaxCents: number;
};

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

/** Bouwt `col in ('a','b')` met correcte placeholders (drizzle expandeert arrays niet in ruwe sql). */
function inList(col: SQL, values: string[]): SQL {
  return sql`${col} in (${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  )})`;
}

/** Variant-niveau EXISTS — één variant moet aan álle gekozen variant-filters voldoen. */
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
  return sql`exists (select 1 from ${productVariants} v where ${sql.join(parts, sql` and `)})`;
}

function allConditions(f: ProductFilters): SQL[] {
  const conds = contextConditions(f);
  if (f.fits?.length) {
    conds.push(inList(sql`${products.attributes} ->> 'pasvorm'`, f.fits));
  }
  const ve = variantExists(f);
  if (ve) conds.push(ve);
  return conds;
}

const SORT_ORDER: Record<ProductSort, SQL> = {
  nieuw: sql`${products.sourceCreatedAt} desc nulls last`,
  "prijs-op": sql`mp asc nulls last`,
  "prijs-af": sql`mp desc nulls last`,
  naam: sql`${products.title} asc`,
};

export async function getFilteredProducts(
  f: ProductFilters,
  sort: ProductSort,
  page: number,
  perPage: number
): Promise<{ items: ProductCardData[]; total: number }> {
  const db = getDb();
  const conds = allConditions(f);
  const whereSql = sql.join(conds, sql` and `);
  const offset = (page - 1) * perPage;

  // Pagineer op product-id met min-prijs voor de prijs-sortering.
  const idRows = await db.execute<{ id: string }>(sql`
    select ${products.id} as id,
           (select min(v2.price_cents) from ${productVariants} v2 where v2.product_id = ${products.id}) as mp
    from ${products}
    where ${whereSql}
    order by ${SORT_ORDER[sort]}
    limit ${perPage} offset ${offset}
  `);
  const totalRes = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from ${products} where ${whereSql}
  `);
  const total = Number(totalRes.rows[0]?.n ?? 0);

  const ids = idRows.rows.map((r) => r.id);
  if (!ids.length) return { items: [], total };

  // Hydrateer kaarten in dezelfde volgorde.
  const base = await db
    .select({
      id: products.id,
      handle: products.handle,
      title: products.title,
      vendor: products.vendor,
    })
    .from(products)
    .where(inArray(products.id, ids));
  const byId = new Map(base.map((p) => [p.id, p]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as typeof base;
  return { items: await buildProductCards(ordered), total };
}

export async function getFacets(f: ProductFilters): Promise<Facets> {
  const db = getDb();
  // Facetten binnen de context (collectie/categorie), onafhankelijk van de
  // gekozen kleur/maat/pasvorm — zo blijven alle opties met telling zichtbaar.
  const ctx = sql.join(contextConditions(f), sql` and `);

  const [colorRows, sizeRows, fitRows, priceRow] = await Promise.all([
    db.execute<{ fam: string; n: number }>(sql`
      select v.color_family as fam, count(distinct ${products.id})::int as n
      from ${products} join ${productVariants} v on v.product_id = ${products.id}
      where ${ctx} and v.color_family <> ''
      group by v.color_family`),
    db.execute<{ size: string; n: number }>(sql`
      select v.size_label as size, count(distinct ${products.id})::int as n
      from ${products} join ${productVariants} v on v.product_id = ${products.id}
      where ${ctx} and v.size_label <> ''
      group by v.size_label`),
    db.execute<{ fit: string; n: number }>(sql`
      select ${products.attributes} ->> 'pasvorm' as fit, count(*)::int as n
      from ${products}
      where ${ctx} and ${products.attributes} ->> 'pasvorm' is not null and ${products.attributes} ->> 'pasvorm' <> ''
      group by ${products.attributes} ->> 'pasvorm'`),
    db.execute<{ lo: number; hi: number }>(sql`
      select min(v.price_cents)::int as lo, max(v.price_cents)::int as hi
      from ${products} join ${productVariants} v on v.product_id = ${products.id}
      where ${ctx}`),
  ]);

  const colorCount = new Map(colorRows.rows.map((r) => [r.fam, r.n]));
  const colors = COLOR_FAMILIES.filter((c) => colorCount.has(c.key)).map((c) => ({
    ...c,
    count: colorCount.get(c.key) ?? 0,
  }));

  // Lettermaat-buckets (XS/M/L/…) in natuurlijke volgorde — nette filter i.p.v.
  // een platte lijst van 44/46/98/25/One door elkaar.
  const sizes = sizeRows.rows
    .map((r) => ({ value: r.size, label: rowDisplayLabel(r.size), count: r.n }))
    .sort((a, b) => rowSortIndex(a.value) - rowSortIndex(b.value));

  const fits = fitRows.rows
    .map((r) => ({ value: r.fit, count: r.n }))
    .sort((a, b) => b.count - a.count);

  return {
    colors,
    sizes,
    fits,
    priceMinCents: Number(priceRow.rows[0]?.lo ?? 0),
    priceMaxCents: Number(priceRow.rows[0]?.hi ?? 0),
  };
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
 * Catalogus-zoek: matcht op titel, vendor, hoofdgroep en handle. Bewust
 * eenvoudig (ILIKE op meerdere woorden) — Meilisearch volgt later.
 */
export async function searchProducts(q: string, limit = 24): Promise<ProductCardData[]> {
  const needle = q.trim();
  if (!needle) return [];
  const db = getDb();
  // Splits in woorden; elk woord moet ergens in titel/handle/vendor/hoofdgroep voorkomen.
  const words = needle.split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
  if (!words.length) return [];
  const conds = words.map(
    (w) => sql`(
      ${products.title} ilike ${"%" + w + "%"} or
      ${products.handle} ilike ${"%" + w + "%"} or
      ${products.vendor} ilike ${"%" + w + "%"} or
      ${products.attributes} ->> 'hoofdgroep_omschrijving' ilike ${"%" + w + "%"}
    )`
  );
  const rows = await db
    .select({
      id: products.id,
      handle: products.handle,
      title: products.title,
      vendor: products.vendor,
    })
    .from(products)
    .where(and(...visibleProductConds(), ...conds))
    .orderBy(desc(products.sourceCreatedAt))
    .limit(limit);
  return buildProductCards(rows);
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
