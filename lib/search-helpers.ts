/**
 * Hulpfuncties voor de zoekmachine: maat-token-herkenning en synoniemen.
 * Zo werkt "overhemd 42" (woord + maat) en "colbert" = "jasje"/"blazer".
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
    return (n >= 28 && n <= 64) || (n >= 80 && n <= 130) || (n >= 36 && n <= 50); // EU, lengte, boord/schoen
  }
  if (/^\d{2}\/\d{2}$/.test(t)) return true; // bv. 41/42 boord
  return false;
}

/** Synoniem-groepen — een treffer op één term matcht de hele groep. */
const SYN_GROUPS: string[][] = [
  ["colbert", "jasje", "blazer", "jas"],
  ["broek", "pantalon", "chino", "trousers"],
  ["stropdas", "das", "tie"],
  ["overhemd", "hemd", "shirt", "blouse"],
  ["pak", "kostuum", "suit", "driedelig", "tweedelig"],
  ["trui", "sweater", "pullover", "vest", "cardigan"],
  ["schoen", "schoenen", "shoe", "shoes", "loafer", "veterschoen"],
  ["smoking", "tuxedo", "dinnerjacket"],
  ["pochet", "zakdoek"],
  ["riem", "belt"],
  ["gilet", "vest", "waistcoat"],
  ["bretels", "suspenders"],
];

const SYN_MAP = new Map<string, string[]>();
for (const g of SYN_GROUPS) for (const w of g) SYN_MAP.set(w, g);

/** Geeft het woord + zijn synoniemen terug (voor de OR-match per token). */
export function expandSynonyms(word: string): string[] {
  const w = word.toLowerCase();
  return SYN_MAP.get(w) ?? [w];
}
