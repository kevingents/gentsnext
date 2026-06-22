/**
 * ⚠️ AFGESCHAFT — gebruik `scripts/clean-model-bg.ts`.
 *
 * Dit script trok de studio-achtergrond op naar (bijna) WIT (sharp linear
 * 1.22, -16). Dat is precies wat we NIET meer willen: modelfoto's horen op de
 * égale site-achtergrond #F6F5F2 te staan, consistent met de packshots ernaast.
 * Witte achtergronden hier waren de oorzaak van het kleurverschil in het PLP-grid.
 *
 * De juiste, definitieve aanpak (BiRefNet-uitknip → composite op #F6F5F2,
 * schoon 4:5) zit in `scripts/clean-model-bg.ts`:
 *
 *   npx tsx scripts/clean-model-bg.ts            (alle modelfoto's)
 *   npx tsx scripts/clean-model-bg.ts pak-wol     (alleen handles met 'pak-wol')
 *
 * Dit bestand is bewust een no-op gemaakt zodat de witte-achtergrond-footgun niet
 * per ongeluk opnieuw gedraaid wordt.
 */
console.error(
  "✗ flatten-model-bg is afgeschaft (maakte achtergronden wit).\n" +
    "  Gebruik:  npx tsx scripts/generate-model-photos.ts <aantal> <handles|redo>\n" +
    "  Dat (her)genereert modelfoto's mét de zachte FASHN-studio-gradient (huisstijl).",
);
process.exit(1);
