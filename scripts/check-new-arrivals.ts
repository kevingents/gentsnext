import "@/lib/load-env";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

/** Bevestigt de echte "New arrivals"-collectie + media-gaten (geen credits). */
async function main() {
  const db = getDb();

  const cols = (await db.execute<{ handle: string; title: string; n: number }>(sql`
    select c.handle, c.title, count(pc.product_id)::int n
    from collections c left join product_collections pc on pc.collection_id=c.id
    where c.handle ilike '%nieuw%' or c.title ilike '%arrival%' or c.title ilike '%nieuw%'
    group by c.handle, c.title order by n desc`)).rows;
  console.log("=== Kandidaat-collecties ===");
  cols.forEach((c) => console.log(`  ${String(c.n).padStart(3)}  ${c.handle}  (${c.title})`));

  const H = "nieuwe-collectie-gents";
  const inCol = sql`exists (select 1 from product_collections pc join collections c on c.id=pc.collection_id where pc.product_id=p.id and c.handle=${H})`;
  const base = sql`p.status='active' and p.is_group_primary`;

  const r = (await db.execute<Record<string, number>>(sql`
    select
      count(*) filter (where ${inCol}) total,
      count(*) filter (where ${inCol} and p.has_image and p.in_stock) bruikbaar,
      count(*) filter (where ${inCol} and p.has_image and p.in_stock and p.model_image_url='') geen_model,
      count(*) filter (where ${inCol} and p.has_image and p.in_stock and p.lifestyle_image_url='' and p.lifestyle_image_url2='' and p.lifestyle_image_url3='') geen_sfeer,
      count(*) filter (where ${inCol} and p.has_image and p.in_stock and p.model_video_url='') geen_video
    from products p where ${base}`)).rows[0];
  console.log(`\n=== Collectie ${H} ===`);
  console.log(r);

  const hg = (await db.execute<{ hg: string; n: number }>(sql`
    select coalesce(p.attributes->>'hoofdgroep_omschrijving','—') hg, count(*)::int n
    from products p where ${base} and ${inCol} group by 1 order by 2 desc`)).rows;
  console.log("per hoofdgroep:");
  hg.forEach((x) => console.log(`  ${String(x.n).padStart(3)}  ${x.hg}`));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
