import { koppelUitAttributen, koppelUitSrs, koppelStand, srsBeschikbaar } from "@/lib/srs-artikelen";

/**
 * Vult de SRS-koppeling op productniveau (srs_artikel_nummer, srs_kleur_id,
 * srs_gezien_op). Zie lib/srs-artikelen.ts voor waarom er twee wegen zijn.
 *
 *   npm run koppel:srs -- --droog          # niets schrijven, alleen tellen
 *   npm run koppel:srs -- --attributen     # uit onze eigen brondata (geen SRS nodig)
 *   npm run koppel:srs                     # uit SRS (volledig bestand)
 *   npm run koppel:srs -- --delta          # uit SRS, alleen de laatste 72 uur
 *
 * Zonder SRS-inloggegevens valt hij terug op --attributen en zegt dat erbij,
 * in plaats van te stoppen: de helft van de koppeling kunnen we ook zonder SRS.
 */
async function main() {
  const args = process.argv.slice(2);
  const droogdraaien = args.includes("--droog");
  const delta = args.includes("--delta");
  const forceerAttributen = args.includes("--attributen");

  console.log("SRS-koppeling op productniveau");
  console.log(droogdraaien ? "  DROOGDRAAIEN — er wordt niets weggeschreven.\n" : "");

  const voor = await koppelStand();
  console.log("Voor:");
  toonStand(voor);

  const viaSrs = !forceerAttributen && srsBeschikbaar();
  if (!forceerAttributen && !viaSrs) {
    console.log("\n! SRS_API_USER/SRS_API_PASSWORD ontbreken — ik gebruik de brondata.");
    console.log("  Daarmee komt er geen kleur-id en geen srs_gezien_op; zie lib/srs-artikelen.ts.\n");
  }

  const r = viaSrs
    ? await koppelUitSrs({ delta, droogdraaien })
    : await koppelUitAttributen(droogdraaien);

  if ("error" in r) {
    console.error(`\nMislukt: ${r.error}`);
    process.exit(1);
  }

  console.log(`\nBron: ${r.bron}${r.bron === "srs" && delta ? " (delta, laatste 72 uur)" : ""}`);
  console.log(`  bekeken:      ${r.bekeken}`);
  console.log(`  gekoppeld:    ${r.gekoppeld}`);
  console.log(`  al goed:      ${r.ongewijzigd}`);
  if (r.bron === "srs") console.log(`  niet in feed: ${r.zonderMatch}${delta ? " (bij een delta zegt dit niets)" : ""}`);

  if (r.botsingen.length) {
    console.log(`\n! ${r.botsingen.length} artikelnummer(s) hangen aan meer dan één product — overgeslagen:`);
    for (const b of r.botsingen.slice(0, 20)) console.log(`    ${b.artikelNummer}: ${b.handles.join(", ")}`);
    if (r.botsingen.length > 20) console.log(`    … en nog ${r.botsingen.length - 20}`);
    console.log("  Dit zijn duplicaten in de catalogus. Ruim ze op, draai daarna opnieuw.");
  }

  if (!droogdraaien) {
    console.log("\nNa:");
    toonStand(await koppelStand());
  }
}

function toonStand(s: Awaited<ReturnType<typeof koppelStand>>) {
  const pct = (n: number) => (s.totaal ? ` (${Math.round((n / s.totaal) * 100)}%)` : "");
  console.log(`  producten:        ${s.totaal}`);
  console.log(`  met artikelnr:    ${s.metNummer}${pct(s.metNummer)}`);
  console.log(`  met kleur-id:     ${s.metKleur}${pct(s.metKleur)}`);
  console.log(`  gezien in SRS:    ${s.gezienInSrs}${pct(s.gezienInSrs)}${s.laatstGezien ? ` — laatst ${s.laatstGezien}` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
