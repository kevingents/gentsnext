import { synchroniseerProductMedia } from "@/lib/shopify-media";

/**
 * Productfoto's uit Shopify bijhalen. Zie lib/shopify-media.ts.
 *
 *   npm run media:sync -- --droog                 # niets schrijven, alleen tellen
 *   npm run media:sync -- --dagen 30              # wat er in 30 dagen wijzigde
 *   npm run media:sync -- --zonder-beeld          # de achterstand: artikelen zonder foto
 *   npm run media:sync -- --handle pak-3-delig-double-breasted-ecru
 */
async function main() {
  const args = process.argv.slice(2);
  const vlag = (n: string) => args.includes(n);
  const waarde = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const handle = waarde("--handle");
  const dagen = Number(waarde("--dagen") || 0);
  const droogdraaien = vlag("--droog");

  const opties = handle
    ? { handles: [handle], droogdraaien }
    : vlag("--zonder-beeld")
      ? { alleenZonderBeeld: true, limiet: Number(waarde("--limiet") || 400), droogdraaien }
      : { sinds: new Date(Date.now() - (dagen || 3) * 24 * 60 * 60 * 1000), droogdraaien };

  console.log("Shopify-media synchroniseren");
  console.log(
    `  ${handle ? `alleen ${handle}` : vlag("--zonder-beeld") ? "artikelen zonder foto" : `gewijzigd in de laatste ${dagen || 3} dagen`}`,
  );
  if (droogdraaien) console.log("  DROOGDRAAIEN — er wordt niets weggeschreven.");
  console.log("");

  const r = await synchroniseerProductMedia(opties);
  if ("error" in r) {
    console.error(`Mislukt: ${r.error}`);
    process.exit(1);
  }

  console.log(`  bekeken:            ${r.bekeken}`);
  console.log(`  bijgewerkt:         ${r.bijgewerkt}`);
  console.log(`  ongewijzigd:        ${r.ongewijzigd}`);
  console.log(`  beelden erbij:      ${r.beeldenErbij}`);
  console.log(`  beelden eraf:       ${r.beeldenEraf}`);
  console.log(`  niet in Shopify:    ${r.nietInShopify}`);
  console.log(`  daar ook geen foto: ${r.ookDaarGeenBeeld}`);
  if (r.voorbeelden.length) {
    console.log("\n  voorbeelden:");
    for (const v of r.voorbeelden) console.log(`    ${v.handle}: ${v.van} → ${v.naar} beeld(en)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
