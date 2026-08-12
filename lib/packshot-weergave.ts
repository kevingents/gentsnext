/**
 * Hoe een accessoire-packshot in een tegel hoort te staan.
 *
 * Riemen, dassen, strikken, manchetknopen, pochets en bretels worden niet
 * bijgesneden (object-cover zou de helft van een riem afkappen) maar heel
 * getoond. Dat deel klopte al; twee dingen eromheen niet:
 *
 *  - De tegel zette er nóg 16px padding overheen, terwijl deze packshots hun
 *    eigen studiomarge al in het beeld hebben. Dubbele marge: het product stond
 *    klein in het midden met wit eromheen.
 *  - De tegelachtergrond is `surface` (#F6F5F2, warme off-white) en de packshots
 *    staan op PUUR WIT (gemeten: 255,255,255 in alle hoeken). De letterbox-
 *    randen links en rechts vielen daardoor op als een lichtere balk in een
 *    donkerder kader.
 *
 * Vandaar: geen padding, en een witte tegel — dan valt de rand weg tegen de
 * foto en lijkt het beeld de tegel te vullen, zonder ook maar iets bij te
 * snijden. Alle bronbeelden zijn 2:3 (400×600), de tegel is 3:4.
 */
const PACKSHOT_CONTAIN = new Set([
  "Riemen", "Stropdassen", "Strikken", "Manchetknopen", "Pochet", "Bretels", "Sjaals", "Sjaal", "Dasspelden",
]);

/** Wordt dit packshot heel getoond (i.p.v. bijgesneden) in een tegel? */
export function packshotContain(hoofdgroep: string): boolean {
  return PACKSHOT_CONTAIN.has(String(hoofdgroep || "").trim());
}
