import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { products, productVariants, productImages } from "@/db/schema";
import { availableForSkus } from "@/lib/stock-reservations";
import { deriveVariant, MAX_GROUP_SIZE, colorIsArticle } from "@/lib/variant-grouping";

/**
 * De gedenormaliseerde catalogus-vlaggen: has_image, in_stock, stock_qty (product
 * én variant) en de kleurgroep-velden. De hele listing hangt hieraan — PLP-filter,
 * maat-facetten, zoeken, ranking (`OP_WEBSITE_SQL` in lib/catalog).
 *
 * Twee dingen zaten hier fout, allebei onzichtbaar vanaf de site:
 *
 * 1. BRUTO in plaats van NETTO. De vlag werd gezet op de kale SRS-voorraad, terwijl
 *    de PDP verkoopt op wat er écht beschikbaar is (− kassa-verkopen, − web-
 *    reserveringen, − apart gelegde stuks, − veiligheidsvoorraad, en alleen uit
 *    LEVERBARE filialen). Gevolg: een product stond in de listing en op de PDP was
 *    elke maat uitverkocht. Nu rekenen listing en PDP met hetzelfde getal.
 *
 * 2. NIEMAND ververste ze. Dit draaide alleen als iemand `npm run sync:catalog`
 *    tikte; op 12 aug 2026 stonden de vlaggen 15 dagen stil (2.118 varianten met een
 *    achterhaald aantal, 93 die "op voorraad" heetten maar leeg waren). Vandaar dat
 *    dit nu een lib is die óók vanaf een cron draait (/api/cron/sync-catalog).
 *
 * Bewust NIET hier: de terug-op-voorraad-mails. Die horen bij één cron
 * (/api/cron/stock-check) — anders mailt elke extra aanroeper de klant nog eens.
 */

export type CatalogFlagsSamenvatting = {
  producten: number;
  varianten: number;
  zichtbaar: number;
  kleurgroepen: number;
  opVoorraad: number;
};

/** Rijen in stukken hakken — bulk-updates gaan per chunk in één statement. */
function chunk<T>(a: T[], n: number): T[][] {
  return Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
}

/**
 * Netto beschikbaarheid per sku, in stukken opgehaald. Per chunk gaan er een paar
 * queries naar Neon; alles in één keer zou een IN-lijst van 25.000 sku's worden.
 * De veiligheidsvoorraad blijft correct over de chunks heen: availableForSkus
 * zoekt zelf de hele maatboog van een artikel op voordat 'ie het budget verdeelt.
 */
async function nettoPerSku(skusPerProduct: string[][]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const groep of chunk(skusPerProduct, 100)) {
    const skus = [...new Set(groep.flat())];
    if (!skus.length) continue;
    const avail = await availableForSkus(skus);
    for (const [sku, st] of avail) out.set(sku, Math.max(0, st.online));
  }
  return out;
}

export async function syncCatalogFlags(): Promise<CatalogFlagsSamenvatting> {
  const db = getDb();

  const prods = await db
    .select({ id: products.id, title: products.title, attributes: products.attributes })
    .from(products)
    .where(eq(products.status, "active"));

  const variants = await db
    .select({ productId: productVariants.productId, id: productVariants.id, sku: productVariants.sku })
    .from(productVariants);

  const imgRows = await db
    .select({ productId: productImages.productId, n: sql<number>`count(*)::int` })
    .from(productImages)
    .groupBy(productImages.productId);
  const imageCount = new Map(imgRows.map((r) => [r.productId, r.n]));

  const byProduct = new Map<string, { id: string; sku: string }[]>();
  for (const v of variants) {
    if (!byProduct.has(v.productId)) byProduct.set(v.productId, []);
    byProduct.get(v.productId)!.push({ id: v.id, sku: v.sku });
  }

  // Alleen de sku's van ACTIEVE producten: een archief-product hoeft geen
  // beschikbaarheidsberekening (en scheelt een kwart van het werk).
  const skusPerProduct = prods.map((p) => (byProduct.get(p.id) ?? []).map((v) => v.sku).filter(Boolean));
  const netto = await nettoPerSku(skusPerProduct);

  const variantStock: { id: string; qty: number }[] = [];
  const meta = new Map<string, { hasImage: boolean; inStock: boolean; stockQty: number; title: string; hoofdgroep: string }>();
  for (const p of prods) {
    const attrs = (p.attributes ?? {}) as Record<string, unknown>;
    const hoofdgroep = String(attrs.hoofdgroep_omschrijving || "");
    let total = 0;
    for (const v of byProduct.get(p.id) ?? []) {
      const q = v.sku ? netto.get(v.sku) ?? 0 : 0;
      variantStock.push({ id: v.id, qty: q });
      total += q;
    }
    meta.set(p.id, {
      hasImage: (imageCount.get(p.id) ?? 0) > 0,
      inStock: total > 0,
      stockQty: total,
      title: p.title,
      hoofdgroep,
    });
  }

  /* Kleurgroepen: één primair product per groep in de listing. */
  const groups = new Map<string, { id: string; color: string }[]>();
  const colorLabelById = new Map<string, string>();
  for (const p of prods) {
    const m = meta.get(p.id)!;
    const dv = deriveVariant(m.title, m.hoofdgroep);
    colorLabelById.set(p.id, dv.colorLabel);
    if (dv.baseKey) {
      if (!groups.has(dv.baseKey)) groups.set(dv.baseKey, []);
      groups.get(dv.baseKey)!.push({ id: p.id, color: dv.colorLabel });
    }
  }

  const groupKeyById = new Map<string, string>();
  const isPrimaryById = new Map<string, boolean>();
  const colorCountById = new Map<string, number>();
  for (const p of prods) {
    groupKeyById.set(p.id, "");
    isPrimaryById.set(p.id, true);
    colorCountById.set(p.id, 1);
  }

  let realGroups = 0;
  for (const [key, members] of groups) {
    const distinctColors = new Set(members.map((m) => m.color)).size;
    if (members.length < 2 || members.length > MAX_GROUP_SIZE || distinctColors < 2) continue;
    realGroups++;
    // Bij accessoires IS de kleur het artikel (pochet, das, strik, sokken):
    // daar blijft élk lid primair, zodat de klant alle kleuren in het overzicht
    // ziet. De groep zelf blijft staan — de kleurenbalk op de PDP werkt gewoon.
    const alleKleurenTonen = colorIsArticle(meta.get(members[0].id)!.hoofdgroep);
    // Primair = best zichtbare (foto+voorraad) met meeste voorraad.
    const ranked = [...members].sort((a, b) => {
      const ma = meta.get(a.id)!;
      const mb = meta.get(b.id)!;
      const sa = (ma.hasImage ? 2 : 0) + (ma.inStock ? 1 : 0);
      const sb = (mb.hasImage ? 2 : 0) + (mb.inStock ? 1 : 0);
      if (sb !== sa) return sb - sa;
      return mb.stockQty - ma.stockQty;
    });
    const primaryId = ranked[0].id;
    for (const m of members) {
      groupKeyById.set(m.id, key);
      isPrimaryById.set(m.id, alleKleurenTonen || m.id === primaryId);
      colorCountById.set(m.id, members.length);
    }
  }

  /* Bulk-schrijven: één UPDATE … FROM (VALUES …) per chunk. Was een losse UPDATE
     per rij (≈26.000 round-trips naar neon-http) — te traag om ooit op een cron
     te kunnen draaien, en dát is precies waarom deze vlaggen 15 dagen stilstonden. */
  for (const part of chunk(prods.map((p) => p.id), 400)) {
    const rows = part.map((id) => {
      const m = meta.get(id)!;
      return sql`(${id}::uuid, ${m.hasImage}::boolean, ${m.inStock}::boolean, ${m.stockQty}::int, ${groupKeyById.get(id)!}::text, ${isPrimaryById.get(id)!}::boolean, ${colorCountById.get(id)!}::int, ${colorLabelById.get(id) || ""}::text)`;
    });
    await db.execute(sql`
      update products p set
        has_image = d.has_image, in_stock = d.in_stock, stock_qty = d.stock_qty,
        variant_group_key = d.variant_group_key, is_group_primary = d.is_group_primary,
        group_color_count = d.group_color_count, variant_color_label = d.variant_color_label,
        stock_synced_at = now()
      from (values ${sql.join(rows, sql`, `)})
        as d(id, has_image, in_stock, stock_qty, variant_group_key, is_group_primary, group_color_count, variant_color_label)
      where p.id = d.id`);
  }

  for (const part of chunk(variantStock, 800)) {
    const rows = part.map((v) => sql`(${v.id}::uuid, ${v.qty}::int)`);
    await db.execute(sql`
      update product_variants v set stock_qty = d.qty
      from (values ${sql.join(rows, sql`, `)}) as d(id, qty)
      where v.id = d.id`);
  }

  /* Zoekwoorden-vocabulaire ("bedoelde je …?") volgt de zichtbare catalogus. */
  await db.execute(sql.raw(`create table if not exists search_terms (term text primary key, freq integer not null default 1)`));
  await db.execute(sql.raw(`create index if not exists search_terms_trgm on search_terms using gin (term gin_trgm_ops)`));
  await db.execute(sql.raw(`truncate search_terms`));
  await db.execute(sql.raw(`
    insert into search_terms (term, freq)
    select w, count(*)::int from (
      select unnest(regexp_split_to_array(
        lower(coalesce(title,'')||' '||coalesce(vendor,'')||' '||coalesce(attributes->>'hoofdgroep_omschrijving','')||' '||coalesce(attributes->>'subgroep','')),
        '[^a-z0-9]+')) w
      from products where status='active' and has_image and in_stock and is_group_primary
    ) s
    where length(w) >= 3 and w ~ '^[a-z]+$'
    group by w
    on conflict (term) do update set freq = excluded.freq`));

  const zichtbaar = prods.filter((p) => meta.get(p.id)!.hasImage && meta.get(p.id)!.inStock && isPrimaryById.get(p.id)).length;
  return {
    producten: prods.length,
    varianten: variantStock.length,
    zichtbaar,
    kleurgroepen: realGroups,
    opVoorraad: [...meta.values()].filter((m) => m.inStock).length,
  };
}
