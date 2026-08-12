import "@/lib/load-env";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { sizeRowLabel } from "@/lib/size-taxonomy";

/**
 * Herberekent size_label (de lettermaat-bucket) op alle varianten.
 *
 * MET de hoofdgroep van het product erbij — dat is de hele reden dat dit script
 * opnieuw gedraaid moet worden. Hetzelfde getal betekent in twee reeksen iets
 * anders: 44 is pakmaat XS én overhemd-boordmaat XL. Omdat de oude versie per
 * KALE maat werkte (select distinct size, zonder product), won overal de
 * pakkenreeks en kregen boordmaten 42/44/46/48/50/52 de labels XXS/XS/S/M/M-L/L.
 * Een 4XL-hals stond dus in de bucket XS, en "Shop in jouw maat" pakte de
 * verkeerde overhemden.
 *
 *   npm run backfill:sizelabel            (schrijft)
 *   npm run backfill:sizelabel -- --droog (toont alleen wat er zou wijzigen)
 */
async function main() {
  const db = getDb();
  const droog = process.argv.includes("--droog");

  // Per (hoofdgroep, maat) één berekening — dat zijn er een paar honderd i.p.v.
  // een update per variant.
  const paren = (
    await db.execute<{ hg: string; size: string; huidig: string; n: number }>(sql`
      select coalesce(p.attributes->>'hoofdgroep_omschrijving','') hg,
             v.size, coalesce(v.size_label,'') huidig, count(*)::int n
      from product_variants v
      join products p on p.id = v.product_id
      where coalesce(v.size,'') <> ''
      group by 1, 2, 3
    `)
  ).rows;

  const teWijzigen = paren
    .map((r) => ({ ...r, nieuw: sizeRowLabel(r.size, r.hg) }))
    .filter((r) => r.nieuw !== r.huidig);

  console.log(`${paren.length} (hoofdgroep, maat)-combinaties — ${teWijzigen.length} wijzigen.`);
  for (const r of teWijzigen.slice().sort((a, b) => b.n - a.n).slice(0, 40)) {
    console.log(`  ${String(r.n).padStart(5)}×  ${r.hg || "(geen)"} ${r.size}: ${r.huidig || "∅"} → ${r.nieuw}`);
  }
  if (teWijzigen.length > 40) console.log(`  … en nog ${teWijzigen.length - 40}`);
  if (droog) return;

  let gedaan = 0;
  for (const r of teWijzigen) {
    await db.execute(sql`
      update product_variants v
      set size_label = ${r.nieuw}
      from products p
      where p.id = v.product_id
        and v.size = ${r.size}
        and coalesce(p.attributes->>'hoofdgroep_omschrijving','') = ${r.hg}
    `);
    gedaan++;
    if (gedaan % 25 === 0) process.stdout.write(".");
  }

  const dist = (
    await db.execute<{ label: string; n: number }>(sql`
      select size_label label, count(*)::int n from product_variants
      where coalesce(size_label,'') <> '' group by 1 order by 2 desc
    `)
  ).rows;
  console.log(`\n✓ ${gedaan} combinaties bijgewerkt. Verdeling per bucket:`);
  for (const d of dist) console.log(`  ${String(d.n).padStart(6)}  ${d.label}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
