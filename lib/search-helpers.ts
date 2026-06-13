/**
 * Hulpfuncties voor de zoekmachine: maat-token-herkenning en synoniemen.
 * Synoniemen zijn beheerbaar in de instellingen (lib/settings.searchSynonyms):
 * elke regel is een groep van komma-gescheiden woorden die elkaars synoniem zijn.
 */

const LETTER_SIZES = new Set([
  "xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl", "3xl", "4xl", "5xl", "6xl", "ml", "s/m", "m/l", "l/xl",
]);

/** Is dit token een maat? (lettermaat, EU-maat 28-64, of lengtemaat 88-130). */
export function isSizeToken(tok: string): boolean {
  const t = tok.toLowerCase().trim();
  if (LETTER_SIZES.has(t)) return true;
  if (/^\d{2,3}$/.test(t)) {
    const n = Number(t);
    return (n >= 28 && n <= 64) || (n >= 80 && n <= 130) || (n >= 36 && n <= 50);
  }
  if (/^\d{2}\/\d{2}$/.test(t)) return true;
  return false;
}

/** Standaard-synoniemen (beheerbaar in de instellingen). Eén groep per regel. */
export const DEFAULT_SYNONYMS = [
  "colbert, jasje, blazer, jas",
  "broek, pantalon, chino, trousers",
  "stropdas, das, tie",
  "overhemd, hemd, shirt, blouse",
  "pak, kostuum, suit, driedelig, tweedelig",
  "trui, sweater, pullover, vest, cardigan",
  "schoen, schoenen, shoe, shoes, loafer, veterschoen",
  "smoking, tuxedo, dinnerjacket",
  "pochet, zakdoek",
  "riem, belt",
  "gilet, vest, waistcoat",
  "bretels, suspenders",
].join("\n");

export type SynonymMap = Map<string, string[]>;

/** Parseert de synoniem-tekst (één groep per regel) naar een lookup-map. */
export function parseSynonyms(text: string): SynonymMap {
  const map: SynonymMap = new Map();
  for (const line of (text || "").split(/\r?\n/)) {
    const group = line
      .split(",")
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    if (group.length < 2) continue;
    for (const w of group) map.set(w, group);
  }
  return map;
}

const DEFAULT_MAP = parseSynonyms(DEFAULT_SYNONYMS);

/** Geeft het woord + zijn synoniemen terug (voor de OR-match per token). */
export function expandSynonyms(word: string, map: SynonymMap = DEFAULT_MAP): string[] {
  const w = word.toLowerCase();
  return map.get(w) ?? [w];
}
