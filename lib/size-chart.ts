/**
 * GENTS autoritatieve maattabel (bron: Faslet-SizeChart-GENTS, juni 2026).
 *
 * Dit is de ÉCHTE GENTS-maatvoering: lichaamsmaten in cm → GENTS-confectiemaat per
 * categorie. Het is bewust de bron-van-waarheid die de oude formule-heuristiek
 * (jasje ≈ borst/2) vervangt — GENTS valt namelijk anders dan die vuistregel
 * (maat 50 = 107 cm borst, niet 100 cm). Gebruikt door:
 *   - lib/sizing.recommendSizes (maatadvies grondt op deze ranges)
 *   - de "Onze maattabel"-component op PDP/maatadvies
 *
 * Maten zijn lichaamsmaten (cm). Bij colbert/pak staan borst/taille als puntwaarde
 * (min=max, stap 4 cm); bij polo/trui/overhemd als een range; pantalon op taille +
 * binnenbeen. Heupmaat ontbreekt in de bron en is weggelaten.
 */

export type ChartProductType = "TOP" | "BOTTOM" | "FULL_BODY";

export type ChartCategory =
  | "Poloshirts"
  | "Truien"
  | "Colberts (Standaard)"
  | "Overhemden (Boordmaat)"
  | "Pantalon (Standaard)"
  | "Pantalon (Kwart)"
  | "Pantalon (Lang)"
  | "Pakken (algemeen)";

export type ChartRow = {
  productType: ChartProductType;
  category: ChartCategory;
  size: string;
  chestMin: number | null;
  chestMax: number | null;
  waistMin: number | null;
  waistMax: number | null;
  innerLegMin: number | null;
  innerLegMax: number | null;
};

export const SIZE_CHART: ChartRow[] = [
  { productType: "TOP", category: "Poloshirts", size: "S", chestMin: 92, chestMax: 96, waistMin: 80, waistMax: 84, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Poloshirts", size: "M", chestMin: 96, chestMax: 100, waistMin: 84, waistMax: 88, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Poloshirts", size: "L", chestMin: 100, chestMax: 104, waistMin: 88, waistMax: 94, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Poloshirts", size: "XL", chestMin: 104, chestMax: 110, waistMin: 94, waistMax: 100, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Poloshirts", size: "XXL", chestMin: 110, chestMax: 116, waistMin: 100, waistMax: 106, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Poloshirts", size: "3XL", chestMin: 116, chestMax: 122, waistMin: 106, waistMax: 112, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Poloshirts", size: "4XL", chestMin: 122, chestMax: 128, waistMin: 112, waistMax: 118, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Truien", size: "S", chestMin: 92, chestMax: 96, waistMin: 80, waistMax: 84, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Truien", size: "M", chestMin: 96, chestMax: 100, waistMin: 84, waistMax: 88, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Truien", size: "L", chestMin: 100, chestMax: 104, waistMin: 88, waistMax: 94, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Truien", size: "XL", chestMin: 104, chestMax: 110, waistMin: 94, waistMax: 100, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Truien", size: "XXL", chestMin: 110, chestMax: 116, waistMin: 100, waistMax: 106, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Truien", size: "3XL", chestMin: 116, chestMax: 124, waistMin: 106, waistMax: 114, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Colberts (Standaard)", size: "42", chestMin: 91, chestMax: 91, waistMin: 80, waistMax: 80, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Colberts (Standaard)", size: "44", chestMin: 95, chestMax: 95, waistMin: 84, waistMax: 84, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Colberts (Standaard)", size: "46", chestMin: 99, chestMax: 99, waistMin: 88, waistMax: 88, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Colberts (Standaard)", size: "48", chestMin: 103, chestMax: 103, waistMin: 92, waistMax: 92, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Colberts (Standaard)", size: "50", chestMin: 107, chestMax: 107, waistMin: 96, waistMax: 96, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Colberts (Standaard)", size: "52", chestMin: 111, chestMax: 111, waistMin: 100, waistMax: 100, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Colberts (Standaard)", size: "54", chestMin: 115, chestMax: 115, waistMin: 104, waistMax: 104, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Colberts (Standaard)", size: "56", chestMin: 119, chestMax: 119, waistMin: 108, waistMax: 108, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Colberts (Standaard)", size: "58", chestMin: 123, chestMax: 123, waistMin: 112, waistMax: 112, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Colberts (Standaard)", size: "60", chestMin: 127, chestMax: 127, waistMin: 118, waistMax: 118, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Colberts (Standaard)", size: "62", chestMin: 131, chestMax: 131, waistMin: 122, waistMax: 122, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Colberts (Standaard)", size: "64", chestMin: 135, chestMax: 135, waistMin: 126, waistMax: 126, innerLegMin: null, innerLegMax: null },
  { productType: "BOTTOM", category: "Pantalon (Standaard)", size: "42", chestMin: null, chestMax: null, waistMin: 74, waistMax: 74, innerLegMin: 80, innerLegMax: 80 },
  { productType: "BOTTOM", category: "Pantalon (Standaard)", size: "44", chestMin: null, chestMax: null, waistMin: 78, waistMax: 78, innerLegMin: 81, innerLegMax: 81 },
  { productType: "BOTTOM", category: "Pantalon (Standaard)", size: "46", chestMin: null, chestMax: null, waistMin: 82, waistMax: 82, innerLegMin: 82, innerLegMax: 82 },
  { productType: "BOTTOM", category: "Pantalon (Standaard)", size: "48", chestMin: null, chestMax: null, waistMin: 86, waistMax: 86, innerLegMin: 83, innerLegMax: 83 },
  { productType: "BOTTOM", category: "Pantalon (Standaard)", size: "50", chestMin: null, chestMax: null, waistMin: 90, waistMax: 90, innerLegMin: 84, innerLegMax: 84 },
  { productType: "BOTTOM", category: "Pantalon (Standaard)", size: "52", chestMin: null, chestMax: null, waistMin: 94, waistMax: 94, innerLegMin: 85, innerLegMax: 85 },
  { productType: "BOTTOM", category: "Pantalon (Standaard)", size: "54", chestMin: null, chestMax: null, waistMin: 99, waistMax: 99, innerLegMin: 86, innerLegMax: 86 },
  { productType: "BOTTOM", category: "Pantalon (Standaard)", size: "56", chestMin: null, chestMax: null, waistMin: 104, waistMax: 104, innerLegMin: 87, innerLegMax: 87 },
  { productType: "BOTTOM", category: "Pantalon (Standaard)", size: "58", chestMin: null, chestMax: null, waistMin: 109, waistMax: 109, innerLegMin: 88, innerLegMax: 88 },
  { productType: "BOTTOM", category: "Pantalon (Standaard)", size: "60", chestMin: null, chestMax: null, waistMin: 114, waistMax: 114, innerLegMin: 89, innerLegMax: 89 },
  { productType: "BOTTOM", category: "Pantalon (Standaard)", size: "62", chestMin: null, chestMax: null, waistMin: 119, waistMax: 119, innerLegMin: 90, innerLegMax: 90 },
  { productType: "BOTTOM", category: "Pantalon (Standaard)", size: "64", chestMin: null, chestMax: null, waistMin: 124, waistMax: 124, innerLegMin: 91, innerLegMax: 91 },
  { productType: "BOTTOM", category: "Pantalon (Kwart)", size: "24", chestMin: null, chestMax: null, waistMin: 90, waistMax: 90, innerLegMin: 79, innerLegMax: 79 },
  { productType: "BOTTOM", category: "Pantalon (Kwart)", size: "25", chestMin: null, chestMax: null, waistMin: 94, waistMax: 94, innerLegMin: 80, innerLegMax: 80 },
  { productType: "BOTTOM", category: "Pantalon (Kwart)", size: "26", chestMin: null, chestMax: null, waistMin: 98, waistMax: 98, innerLegMin: 81, innerLegMax: 81 },
  { productType: "BOTTOM", category: "Pantalon (Kwart)", size: "27", chestMin: null, chestMax: null, waistMin: 103, waistMax: 103, innerLegMin: 82, innerLegMax: 82 },
  { productType: "BOTTOM", category: "Pantalon (Kwart)", size: "28", chestMin: null, chestMax: null, waistMin: 108, waistMax: 108, innerLegMin: 83, innerLegMax: 83 },
  { productType: "BOTTOM", category: "Pantalon (Kwart)", size: "29", chestMin: null, chestMax: null, waistMin: 113, waistMax: 113, innerLegMin: 84, innerLegMax: 84 },
  { productType: "BOTTOM", category: "Pantalon (Kwart)", size: "30", chestMin: null, chestMax: null, waistMin: 118, waistMax: 118, innerLegMin: 85, innerLegMax: 85 },
  { productType: "BOTTOM", category: "Pantalon (Kwart)", size: "31", chestMin: null, chestMax: null, waistMin: 123, waistMax: 123, innerLegMin: 86, innerLegMax: 86 },
  { productType: "BOTTOM", category: "Pantalon (Kwart)", size: "32", chestMin: null, chestMax: null, waistMin: 128, waistMax: 128, innerLegMin: 87, innerLegMax: 87 },
  { productType: "BOTTOM", category: "Pantalon (Kwart)", size: "33", chestMin: null, chestMax: null, waistMin: 133, waistMax: 133, innerLegMin: 88, innerLegMax: 88 },
  { productType: "BOTTOM", category: "Pantalon (Lang)", size: "90", chestMin: null, chestMax: null, waistMin: 80, waistMax: 80, innerLegMin: 87, innerLegMax: 87 },
  { productType: "BOTTOM", category: "Pantalon (Lang)", size: "94", chestMin: null, chestMax: null, waistMin: 84, waistMax: 84, innerLegMin: 88, innerLegMax: 88 },
  { productType: "BOTTOM", category: "Pantalon (Lang)", size: "98", chestMin: null, chestMax: null, waistMin: 88, waistMax: 88, innerLegMin: 89, innerLegMax: 89 },
  { productType: "BOTTOM", category: "Pantalon (Lang)", size: "102", chestMin: null, chestMax: null, waistMin: 92, waistMax: 92, innerLegMin: 90, innerLegMax: 90 },
  { productType: "BOTTOM", category: "Pantalon (Lang)", size: "106", chestMin: null, chestMax: null, waistMin: 97, waistMax: 97, innerLegMin: 91, innerLegMax: 91 },
  { productType: "BOTTOM", category: "Pantalon (Lang)", size: "110", chestMin: null, chestMax: null, waistMin: 102, waistMax: 102, innerLegMin: 92, innerLegMax: 92 },
  { productType: "BOTTOM", category: "Pantalon (Lang)", size: "114", chestMin: null, chestMax: null, waistMin: 107, waistMax: 107, innerLegMin: 93, innerLegMax: 93 },
  { productType: "BOTTOM", category: "Pantalon (Lang)", size: "118", chestMin: null, chestMax: null, waistMin: 112, waistMax: 112, innerLegMin: 94, innerLegMax: 94 },
  { productType: "FULL_BODY", category: "Pakken (algemeen)", size: "42", chestMin: 91, chestMax: 91, waistMin: 80, waistMax: 80, innerLegMin: 80, innerLegMax: 80 },
  { productType: "FULL_BODY", category: "Pakken (algemeen)", size: "44", chestMin: 95, chestMax: 95, waistMin: 84, waistMax: 84, innerLegMin: 81, innerLegMax: 81 },
  { productType: "FULL_BODY", category: "Pakken (algemeen)", size: "46", chestMin: 99, chestMax: 99, waistMin: 88, waistMax: 88, innerLegMin: 82, innerLegMax: 82 },
  { productType: "FULL_BODY", category: "Pakken (algemeen)", size: "48", chestMin: 103, chestMax: 103, waistMin: 92, waistMax: 92, innerLegMin: 83, innerLegMax: 83 },
  { productType: "FULL_BODY", category: "Pakken (algemeen)", size: "50", chestMin: 107, chestMax: 107, waistMin: 96, waistMax: 96, innerLegMin: 84, innerLegMax: 84 },
  { productType: "FULL_BODY", category: "Pakken (algemeen)", size: "52", chestMin: 111, chestMax: 111, waistMin: 100, waistMax: 100, innerLegMin: 85, innerLegMax: 85 },
  { productType: "FULL_BODY", category: "Pakken (algemeen)", size: "54", chestMin: 115, chestMax: 115, waistMin: 104, waistMax: 104, innerLegMin: 86, innerLegMax: 86 },
  { productType: "FULL_BODY", category: "Pakken (algemeen)", size: "56", chestMin: 119, chestMax: 119, waistMin: 108, waistMax: 108, innerLegMin: 87, innerLegMax: 87 },
  { productType: "FULL_BODY", category: "Pakken (algemeen)", size: "58", chestMin: 123, chestMax: 123, waistMin: 112, waistMax: 112, innerLegMin: 88, innerLegMax: 88 },
  { productType: "FULL_BODY", category: "Pakken (algemeen)", size: "60", chestMin: 127, chestMax: 127, waistMin: 118, waistMax: 118, innerLegMin: 89, innerLegMax: 89 },
  { productType: "FULL_BODY", category: "Pakken (algemeen)", size: "62", chestMin: 131, chestMax: 131, waistMin: 122, waistMax: 122, innerLegMin: 90, innerLegMax: 90 },
  { productType: "FULL_BODY", category: "Pakken (algemeen)", size: "64", chestMin: 135, chestMax: 135, waistMin: 126, waistMax: 126, innerLegMin: 91, innerLegMax: 91 },
  { productType: "TOP", category: "Overhemden (Boordmaat)", size: "XS", chestMin: 88, chestMax: 92, waistMin: 76, waistMax: 80, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Overhemden (Boordmaat)", size: "S", chestMin: 92, chestMax: 96, waistMin: 80, waistMax: 84, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Overhemden (Boordmaat)", size: "M", chestMin: 96, chestMax: 100, waistMin: 84, waistMax: 88, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Overhemden (Boordmaat)", size: "L", chestMin: 100, chestMax: 104, waistMin: 88, waistMax: 92, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Overhemden (Boordmaat)", size: "XL", chestMin: 104, chestMax: 108, waistMin: 92, waistMax: 96, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Overhemden (Boordmaat)", size: "XXL", chestMin: 108, chestMax: 112, waistMin: 96, waistMax: 100, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Overhemden (Boordmaat)", size: "3XL", chestMin: 112, chestMax: 116, waistMin: 100, waistMax: 104, innerLegMin: null, innerLegMax: null },
  { productType: "TOP", category: "Overhemden (Boordmaat)", size: "4XL", chestMin: 116, chestMax: 120, waistMin: 104, waistMax: 108, innerLegMin: null, innerLegMax: null },
];

export type BoordRow = {
  confectie: string; // S, M, L, …
  boordCm: string; // bv. "39-40"
  chestMin: number;
  chestMax: number;
  waistMin: number;
  waistMax: number;
};

/** Overhemd: confectiemaat ↔ boordmaat (halsomvang, cm) ↔ borst/taille. +5–6 cm mouwlengte bij de 7-variant. */
export const BOORD_CHART: BoordRow[] = [
  { confectie: "XS", boordCm: "35-36", chestMin: 88, chestMax: 92, waistMin: 76, waistMax: 80 },
  { confectie: "S", boordCm: "37-38", chestMin: 92, chestMax: 96, waistMin: 80, waistMax: 84 },
  { confectie: "M", boordCm: "39-40", chestMin: 96, chestMax: 100, waistMin: 84, waistMax: 88 },
  { confectie: "L", boordCm: "41-42", chestMin: 100, chestMax: 104, waistMin: 88, waistMax: 92 },
  { confectie: "XL", boordCm: "43-44", chestMin: 104, chestMax: 108, waistMin: 92, waistMax: 96 },
  { confectie: "XXL", boordCm: "45-46", chestMin: 108, chestMax: 112, waistMin: 96, waistMax: 100 },
  { confectie: "XXXL", boordCm: "47-48", chestMin: 112, chestMax: 116, waistMin: 100, waistMax: 104 },
  { confectie: "4XL", boordCm: "49-50", chestMin: 116, chestMax: 120, waistMin: 104, waistMax: 108 },
];

/* ─────────────────────────── Lookups ─────────────────────────── */

export const CHART_CATEGORIES = [
  "Pakken (algemeen)",
  "Colberts (Standaard)",
  "Pantalon (Standaard)",
  "Pantalon (Kwart)",
  "Pantalon (Lang)",
  "Overhemden (Boordmaat)",
  "Poloshirts",
  "Truien",
] as const;

export function rowsForCategory(category: ChartCategory): ChartRow[] {
  return SIZE_CHART.filter((r) => r.category === category);
}

/** Welke lichaamsmaat is leidend voor het matchen binnen een categorie. */
export function primaryMeasure(category: ChartCategory): "chest" | "waist" {
  return category.startsWith("Pantalon") ? "waist" : "chest";
}

type MatchResult = { size: string; exact: boolean; row: ChartRow; distanceCm: number };

/** Kies de best passende rij voor een waarde (cm) binnen [min,max]; anders dichtstbij. */
function pickByRange(
  rows: ChartRow[],
  value: number,
  getMin: (r: ChartRow) => number | null,
  getMax: (r: ChartRow) => number | null,
): MatchResult | null {
  let best: MatchResult | null = null;
  for (const r of rows) {
    const lo = getMin(r);
    const hi = getMax(r);
    if (lo == null || hi == null) continue;
    const dist = value < lo ? lo - value : value > hi ? value - hi : 0;
    if (!best || dist < best.distanceCm) {
      best = { size: r.size, exact: dist === 0, row: r, distanceCm: dist };
    }
  }
  return best;
}

/** GENTS-maat voor een borstomvang (cm) binnen een chest-categorie (colbert/pak/polo/trui/overhemd). */
export function sizeByChest(category: ChartCategory, chestCm: number): MatchResult | null {
  return pickByRange(rowsForCategory(category), chestCm, (r) => r.chestMin, (r) => r.chestMax);
}

/** GENTS-maat voor een tailleomvang (cm) binnen een pantalon-categorie. */
export function sizeByWaist(category: ChartCategory, waistCm: number): MatchResult | null {
  return pickByRange(rowsForCategory(category), waistCm, (r) => r.waistMin, (r) => r.waistMax);
}

/** Overhemd-boordmaat (confectie + boord-cm) voor een borstomvang (cm). */
export function boordByChest(chestCm: number): BoordRow | null {
  let best: { row: BoordRow; dist: number } | null = null;
  for (const r of BOORD_CHART) {
    const dist = chestCm < r.chestMin ? r.chestMin - chestCm : chestCm > r.chestMax ? chestCm - r.chestMax : 0;
    if (!best || dist < best.dist) best = { row: r, dist };
  }
  return best?.row ?? null;
}

/** Overhemd-confectie voor een gemeten halsomvang/boordmaat (cm). */
export function boordByCollar(collarCm: number): BoordRow | null {
  let best: { row: BoordRow; dist: number } | null = null;
  for (const r of BOORD_CHART) {
    const [lo, hi] = r.boordCm.split("-").map(Number);
    const dist = collarCm < lo ? lo - collarCm : collarCm > hi ? collarCm - hi : 0;
    if (!best || dist < best.dist) best = { row: r, dist };
  }
  return best?.row ?? null;
}

/** Compacte cm-tekst voor weergave: "107" bij puntwaarde, "96–100" bij range, "—" leeg. */
export function cmText(min: number | null, max: number | null): string {
  if (min == null || max == null) return "—";
  return min === max ? String(min) : `${min}–${max}`;
}
