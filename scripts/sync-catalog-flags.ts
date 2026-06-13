import "@/lib/load-env";
import { getDb } from "@/db";
import { products, productVariants, productImages } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { stockForSkus } from "@/lib/stock";
import { deriveVariant, MAX_GROUP_SIZE } from "@/lib/variant-grouping";
import { processStockNotifications } from "@/lib/stock-notify";

/**
 * Vult de gedenormaliseerde catalogus-vlaggen in één pass:
 *  - has_image        : heeft het product ≥1 afbeelding?
 *  - in_stock/stock_qty: SRS-voorraad (som over varianten) > 0?
 *  - variant_group_key / is_group_primary / group_color_count / variant_color_label
 *                      : kleurvarianten samenvoegen (zie lib/variant-grouping)
 *
 * Idempotent en cron-vriendelijk (voorraad verandert; titels niet). Draai met:
 *   npm run sync:catalog
 */

type Prod = { id: string; title: string; hoofdgroep: string };

async function main() {
  const db = getDb();
  console.log("⏳ producten + varianten laden…");

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

  // Voorraad ophalen voor alle SKU's (in-memory blob-index, 1 fetch).
  const allSkus = [...new Set(variants.map((v) => v.sku).filter(Boolean))];
  console.log(`⏳ voorraad ophalen voor ${allSkus.length} SKU's…`);
  const stock = await stockForSkus(allSkus);

  // Per product: variant-skus + per-variant stock.
  const byProduct = new Map<string, { id: string; sku: string }[]>();
  for (const v of variants) {
    if (!byProduct.has(v.productId)) byProduct.set(v.productId, []);
    byProduct.get(v.productId)!.push({ id: v.id, sku: v.sku });
  }

  // 1. Stock + image flags per product, en variant-stock verzamelen.
  const variantStock: { id: string; qty: number }[] = [];
  const meta = new Map<string, { hasImage: boolean; inStock: boolean; stockQty: number; title: string; hoofdgroep: string }>();
  for (const p of prods) {
    const attrs = (p.attributes ?? {}) as Record<string, unknown>;
    const hoofdgroep = String(attrs.hoofdgroep_omschrijving || "");
    let total = 0;
    for (const v of byProduct.get(p.id) ?? []) {
      const s = v.sku ? stock.get(v.sku) : undefined;
      const q = s?.total ?? 0;
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

  // 2. Kleurgroepen bepalen.
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

  // Per product: group-velden bepalen.
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
      isPrimaryById.set(m.id, m.id === primaryId);
      colorCountById.set(m.id, members.length);
    }
  }

  console.log(`⏳ wegschrijven: ${prods.length} producten, ${realGroups} kleurgroepen…`);

  // 3. Bulk-update producten in chunks.
  const ids = prods.map((p) => p.id);
  const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  for (const part of chunk(ids, 200)) {
    await Promise.all(
      part.map((id) => {
        const m = meta.get(id)!;
        return db
          .update(products)
          .set({
            hasImage: m.hasImage,
            inStock: m.inStock,
            stockQty: m.stockQty,
            variantGroupKey: groupKeyById.get(id)!,
            isGroupPrimary: isPrimaryById.get(id)!,
            groupColorCount: colorCountById.get(id)!,
            variantColorLabel: colorLabelById.get(id) || "",
            stockSyncedAt: sql`now()`,
          })
          .where(eq(products.id, id));
      })
    );
    process.stdout.write(".");
  }

  // 4. Variant-stock bulk-update.
  for (const part of chunk(variantStock, 300)) {
    await Promise.all(part.map((v) => db.update(productVariants).set({ stockQty: v.qty }).where(eq(productVariants.id, v.id))));
    process.stdout.write("+");
  }

  // 5. Rapport.
  const visible = prods.filter((p) => {
    const m = meta.get(p.id)!;
    return m.hasImage && m.inStock && isPrimaryById.get(p.id);
  }).length;
  console.log(`\n✓ Klaar. Zichtbaar in catalogus (foto+voorraad, primair): ${visible} van ${prods.length} actieve producten.`);

  // Zoekwoorden-vocabulaire opnieuw opbouwen (voor "bedoelde je …?").
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
  console.log("✓ zoekwoorden-vocabulaire bijgewerkt.");

  // Terug-op-voorraad-mails versturen voor wat net weer leverbaar is.
  const notified = await processStockNotifications();
  if (notified) console.log(`✓ ${notified} terug-op-voorraad-notificatie(s) verstuurd.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
