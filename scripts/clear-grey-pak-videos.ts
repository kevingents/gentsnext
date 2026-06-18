import "@/lib/load-env";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

/**
 * Stap C-voorbereiding: maakt de model_video_url leeg voor de Pakken in de New
 * arrivals-collectie. Die video's zijn gemaakt vanaf de oude GRIJZE modelfoto;
 * na het herstel (stap A → witte foto) regenereert pakken-media `new` ze opnieuw
 * vanaf de witte foto (alleen de video, m1/m2/detail blijven staan). Geen credits.
 */
async function main() {
  const db = getDb();
  const res = await db.execute<{ handle: string }>(sql`
    update products as p set model_video_url = ''
    where p.model_video_url <> ''
      and p.attributes->>'hoofdgroep_omschrijving' = 'Pakken'
      and exists (
        select 1 from product_collections pc
        join collections c on c.id = pc.collection_id
        where pc.product_id = p.id and c.handle = 'nieuwe-collectie-gents'
      )
    returning p.handle`);
  console.log(`Video leeggemaakt voor ${res.rows.length} New-arrivals-pakken (worden opnieuw gemaakt vanaf de witte foto):`);
  res.rows.forEach((r) => console.log(`  • ${r.handle}`));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
