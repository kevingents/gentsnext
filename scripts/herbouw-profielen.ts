import { herbouwProfielen } from "@/lib/customer-360";
import { bouwAlleDoelgroepen } from "@/lib/audiences";
import { bewaarDoelgroep, haalDoelgroep } from "@/lib/audiences";
import { STANDAARD_DOELGROEPEN } from "@/lib/audience-standaard";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

/**
 * Eenmalige/handmatige herbouw van de klantprofielen + doelgroepen.
 *
 * Draai dit één keer na de migratie; daarna neemt de cron het over.
 * Gebruik: npm run profielen:herbouw [-- --standaard]
 *   --standaard  maakt óók de standaard-doelgroepen aan.
 */
async function main() {
  const metStandaard = process.argv.includes("--standaard");

  console.log("Profielen herbouwen (alle klanten)…");
  const r = await herbouwProfielen();
  console.log(`  ${r.profielen} profielen, ${r.rfm} RFM-scores, ${Math.round(r.ms / 1000)}s`);

  const db = getDb();
  const verdeling = await db.execute<{ segment: string; n: number; besteed: number }>(sql`
    select segment, count(*)::int n, coalesce(sum(besteed_totaal_cents), 0)::bigint besteed
    from customer_profiles group by 1 order by n desc
  `);
  console.log("\nSegmentverdeling:");
  for (const s of verdeling.rows) {
    console.log(`  ${String(s.segment).padEnd(10)} ${String(s.n).padStart(6)}  €${(Number(s.besteed) / 100).toLocaleString("nl-NL")}`);
  }

  const kanalen = await db.execute<{ kanaal: string; n: number }>(sql`
    select kanaal, count(*)::int n from customer_profiles group by 1 order by n desc
  `);
  console.log("\nKanaal:");
  for (const k of kanalen.rows) console.log(`  ${String(k.kanaal).padEnd(10)} ${String(k.n).padStart(6)}`);

  if (metStandaard) {
    console.log("\nStandaard-doelgroepen aanmaken…");
    for (const d of STANDAARD_DOELGROEPEN) {
      const bestond = d.slug ? await haalDoelgroep(d.slug) : null;
      if (bestond) {
        console.log(`  = ${d.slug} (bestond al)`);
        continue;
      }
      await bewaarDoelgroep(d, "script");
      console.log(`  + ${d.slug}`);
    }
  }

  console.log("\nDoelgroepen bouwen…");
  const groepen = await bouwAlleDoelgroepen();
  for (const g of groepen) console.log(`  ${g.slug.padEnd(34)} ${String(g.aantal).padStart(6)} klanten`);

  console.log("\nKlaar.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
