/**
 * ⚠️ AFGESCHAFT — NIET draaien.
 *
 * Dit script knipte het model uit en zette het op een VLAKKE #F6F5F2 — maar de
 * huisstijl is juist de zachte FASHN-studio-GRADIENT (vignet), niet een vlakke
 * achtergrond. Vlak afvlakken gaf een 'kader' en haalde de gewenste gradient weg.
 *
 * Modelfoto's (her)genereren MÉT de juiste gradient gaat via:
 *
 *   npx tsx scripts/generate-model-photos.ts <aantal> <handle1,handle2,…>   (gericht)
 *   npx tsx scripts/generate-model-photos.ts <aantal> redo                  (bestaande)
 *
 * Die pijplijn behoudt de FASHN-studio-gradient (toBlob/padTo45, geen uitknip).
 */
console.error(
  "✗ clean-model-bg is afgeschaft (maakte de achtergrond VLAK i.p.v. de gewenste gradient).\n" +
    "  Gebruik:  npx tsx scripts/generate-model-photos.ts <aantal> <handles|redo>\n" +
    "  Dat (her)genereert modelfoto's mét de zachte studio-gradient.",
);
process.exit(1);
