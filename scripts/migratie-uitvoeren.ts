import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

/**
 * Draai één migratiebestand statement voor statement.
 *
 * Waarom niet `drizzle-kit migrate`: dat leunt op het journaal, en de laatste
 * migraties staan daar bewust niet in — ze worden hier met de hand gezet (zie
 * het besluit "migraties niet automatisch op deploy"). Belangrijker nog:
 * drizzle-kit stopt alles in één transactie, en `CREATE INDEX CONCURRENTLY`
 * mag daar niet in staan.
 *
 * Gebruik: npm run db:migratie -- drizzle/0049_klantprofiel-360-en-doelgroepen.sql
 */

const bestand = process.argv[2];
if (!bestand) {
  console.error("Geef het pad naar het .sql-bestand mee.");
  process.exit(1);
}

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error("DATABASE_URL ontbreekt.");
  process.exit(1);
}

/**
 * Splits op `;` aan het eind van een regel. Bewust simpel: onze migraties
 * bevatten geen functies of dollar-quoted blokken. Zou dat veranderen, dan moet
 * dit slimmer — een half uitgevoerde functie is erger dan geen splitser.
 */
function statements(sqlTekst: string): string[] {
  return sqlTekst
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s && !/^(--[^\n]*\n?)*$/.test(s));
}

async function main() {
  const sql = neon(url!);
  const tekst = readFileSync(bestand, "utf8");
  const lijst = statements(tekst);
  console.log(`${bestand}: ${lijst.length} statements`);

  let n = 0;
  for (const s of lijst) {
    const eerste = s.split("\n").find((r) => r.trim() && !r.trim().startsWith("--"))?.slice(0, 90) ?? "";
    try {
      await sql.query(s);
      n++;
      console.log(`  ✓ ${eerste}`);
    } catch (e) {
      console.error(`  ✗ ${eerste}`);
      console.error(`    ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    }
  }
  console.log(`Klaar: ${n}/${lijst.length} statements uitgevoerd.`);
}

main();
