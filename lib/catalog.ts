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

export type ProductCardData = {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  imageUrl: string;
  imageAlt: string;
  minPriceCents: number;
  hasPriceRange: boolean;
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

  const [images, variants] = await Promise.all([
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
      })
      .from(productVariants)
      .where(inArray(productVariants.productId, ids)),
  ]);

  const firstImage = new Map<string, { url: string; alt: string }>();
  for (const img of images) {
    if (!firstImage.has(img.productId)) firstImage.set(img.productId, { url: img.url, alt: img.alt });
  }
  const priceRange = new Map<string, { min: number; max: number }>();
  for (const v of variants) {
    const range = priceRange.get(v.productId);
    if (!range) priceRange.set(v.productId, { min: v.priceCents, max: v.priceCents });
    else {
      range.min = Math.min(range.min, v.priceCents);
      range.max = Math.max(range.max, v.priceCents);
    }
  }

  return base.map((p) => {
    const img = firstImage.get(p.id);
    const range = priceRange.get(p.id);
    return {
      id: p.id,
      handle: p.handle,
      title: p.title,
      vendor: p.vendor,
      imageUrl: img?.url || "",
      imageAlt: img?.alt || p.title,
      minPriceCents: range?.min ?? 0,
      hasPriceRange: Boolean(range && range.min !== range.max),
    };
  });
}

export async function getCollectionProducts(collectionId: string, page: number, perPage: number) {
  const db = getDb();
  const baseQuery = and(
    eq(productCollections.collectionId, collectionId),
    eq(products.status, "active")
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
    .where(eq(products.status, "active"))
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
  const conds: SQL[] = [eq(products.status, "active")];
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
    where p.status = 'active'
      and p.attributes ->> 'hoofdgroep_omschrijving' in (${sql.join(targets.map((t) => sql`${t}`), sql`, `)})
      and p.id <> ${exclude}
      and exists (select 1 from ${productImages} pi where pi.product_id = p.id)
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
 * Een "highlight"-strip voor de homepage: producten uit een hoofdgroep met
 * beeld, gesorteerd op nieuwste eerst. Voor "nieuw binnen" en categorie-strips.
 */
export async function getHighlights(category: string, limit = 4): Promise<ProductCardData[]> {
  const db = getDb();
  const rows = await db.execute<{ id: string; handle: string; title: string; vendor: string }>(sql`
    select p.id, p.handle, p.title, p.vendor
    from ${products} p
    where p.status = 'active'
      and p.attributes ->> 'hoofdgroep_omschrijving' = ${category}
      and exists (select 1 from ${productImages} pi where pi.product_id = p.id)
    order by p.source_created_at desc nulls last
    limit ${limit}
  `);
  return buildProductCards(rows.rows.map((r) => ({ id: r.id, handle: r.handle, title: r.title, vendor: r.vendor })));
}

/** Lijst van categorieën (hoofdgroep) met telling — voor nav/landing. */
export async function listCategories(): Promise<{ name: string; count: number }[]> {
  const db = getDb();
  const rows = await db.execute<{ name: string; n: number }>(sql`
    select attributes ->> 'hoofdgroep_omschrijving' as name, count(*)::int as n
    from ${products}
    where status = 'active' and attributes ->> 'hoofdgroep_omschrijving' is not null
    group by 1 order by n desc`);
  return rows.rows.map((r) => ({ name: r.name, count: r.n }));
}
