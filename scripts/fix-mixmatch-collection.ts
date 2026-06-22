import "@/lib/load-env";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

/**
 * Herstelt de collectie "Business pakken" (handle mix-match-pakken): de oude leden
 * waren 4 uitverkochte/gearchiveerde complete pakken → 0 zichtbaar. Vult 'm met de
 * in-stock, combineerbare MixMatch-COLBERTS (elk colbert = ingang naar een
 * samenstelbaar pak; de PDP toont de matchende broek + gilet). Idempotent.
 *   npx tsx scripts/fix-mixmatch-collection.ts
 */
async function main() {
  const db = getDb();
  const [col] = (await db.execute<{ id: string }>(sql`select id from collections where handle = 'mix-match-pakken' limit 1`)).rows;
  if (!col) { console.error("Collectie mix-match-pakken niet gevonden."); process.exit(1); }

  await db.execute(sql`delete from product_collections where collection_id = ${col.id}`);
  const res = await db.execute<{ id: string }>(sql`
    insert into product_collections (collection_id, product_id, position)
    select ${col.id}, p.id, (row_number() over (order by p.stock_qty desc nulls last, p.title))::int - 1
    from products p
    where p.status = 'active' and p.in_stock and p.has_image and p.is_group_primary
      and p.attributes->>'mix_and_match' = 'Ja'
      and p.attributes->>'hoofdgroep_omschrijving' = 'Colberts'
    returning product_id as id
  `);
  console.log(`✓ ${res.rows.length} MixMatch-colberts in collectie "Business pakken" (mix-match-pakken).`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
