import "@/lib/load-env";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { NEGATIE, knipOntkenning } from "@/lib/feedback-directive";

/**
 * Reparatie-run: de omgezette notities die tóch een ontkenning bevatten.
 *
 * De omzetter kreeg te horen dat hij geen "not"/"avoid"/"never" mocht gebruiken
 * en deed het toch — 11 van de eerste 26. "Pair the blazer with trousers in a
 * contrasting color, not matching the jacket" gaat zo de prompt in, en een
 * beeldmodel leest vooral "matching the jacket". De code vangt dit nu af bij het
 * opslaan; dit script haalt de regels op die er al staan.
 *
 * Puur tekstwerk: de ontkennende staart eraf, de wens blijft staan. Blijft er te
 * weinig over, dan zetten we directive op null — dan valt de prompt terug op de
 * categorie-regel, die altijd positief geformuleerd is.
 *
 *   npx tsx scripts/schoon-directives.ts          (laat zien wat er zou gebeuren)
 *   npx tsx scripts/schoon-directives.ts --doen   (voert het uit)
 */
const DOEN = process.argv.includes("--doen");

async function main() {
  const db = getDb();
  let aangepast = 0;
  let geleegd = 0;

  for (const tabel of ["model_learnings", "visual_learnings"] as const) {
    const rows = (await db.execute<{ id: string; directive: string }>(
      tabel === "model_learnings"
        ? sql`select id, directive from model_learnings where directive is not null`
        : sql`select id, directive from visual_learnings where directive is not null`,
    )).rows;

    for (const r of rows) {
      if (!NEGATIE.test(r.directive)) continue;
      const schoon = knipOntkenning(r.directive);
      const nieuw = schoon.length > 8 && !NEGATIE.test(schoon) ? schoon : null;
      console.log(`[${tabel} #${r.id}]`);
      console.log(`  was: ${r.directive}`);
      console.log(`  nu:  ${nieuw ?? "(leeg — valt terug op de categorie-regel)"}`);
      if (nieuw) aangepast++; else geleegd++;
      if (DOEN) {
        if (tabel === "model_learnings") {
          await db.execute(sql`update model_learnings set directive = ${nieuw} where id = ${r.id}`);
        } else {
          await db.execute(sql`update visual_learnings set directive = ${nieuw} where id = ${r.id}`);
        }
      }
    }
  }

  console.log(`\n${aangepast} bijgeknipt, ${geleegd} geleegd${DOEN ? "" : " — proefrun, gebruik --doen om het uit te voeren"}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
