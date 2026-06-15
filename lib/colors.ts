/**
 * Kleurnaam → swatch-weergave. De catalogus gebruikt Nederlandse kleurnamen
 * (Blauw, Antraciet, Cognac, …). Voor swatches mappen we die naar een hex of
 * een verloop (voor multikleur/print). Onbekende namen vallen terug op een
 * neutrale grijstint, zodat een swatch nooit "stuk" is.
 *
 * `family` groepeert kleuren voor het PLP-filter "kleurfamilie".
 */

export type ColorFamily =
  | "blauw"
  | "zwart"
  | "grijs"
  | "wit"
  | "bruin"
  | "groen"
  | "rood"
  | "beige"
  | "roze"
  | "paars"
  | "geel"
  | "oranje"
  | "multi";

type Swatch = { hex: string; family: ColorFamily; gradient?: string };

// Basismap op exact-genormaliseerde naam (lowercase, getrimd).
const MAP: Record<string, Swatch> = {
  // Blauw-familie
  blauw: { hex: "#2F4A6B", family: "blauw" },
  lichtblauw: { hex: "#8FB3D9", family: "blauw" },
  donkerblauw: { hex: "#1E2F4D", family: "blauw" },
  navy: { hex: "#1A1A2E", family: "blauw" },
  "royal blue": { hex: "#2B4FA2", family: "blauw" },
  "blauw wit": { hex: "#9DB7D4", family: "blauw", gradient: "linear-gradient(135deg,#2F4A6B 50%,#FFFFFF 50%)" },
  witblauw: { hex: "#C7D6E8", family: "blauw" },
  blauwgrijs: { hex: "#6B7A8F", family: "blauw" },
  "grijs blauw": { hex: "#6B7A8F", family: "blauw" },
  // Zwart
  zwart: { hex: "#141414", family: "zwart" },
  // Grijs
  grijs: { hex: "#8B8B8B", family: "grijs" },
  lichtgrijs: { hex: "#C9C7C2", family: "grijs" },
  antraciet: { hex: "#3A3B3D", family: "grijs" },
  antra: { hex: "#3A3B3D", family: "grijs" },
  grijsbruin: { hex: "#8A7E6E", family: "grijs" },
  // Wit
  wit: { hex: "#FAFAF7", family: "wit" },
  ecru: { hex: "#F0EBDD", family: "wit" },
  // Bruin
  bruin: { hex: "#6B4A2F", family: "bruin" },
  cognac: { hex: "#9A5B2E", family: "bruin" },
  camel: { hex: "#B8895A", family: "bruin" },
  // Groen — meerdere tinten, duidelijk uit elkaar (lichtgroen ≠ groen ≠ donkergroen)
  groen: { hex: "#3E5240", family: "groen" },
  lichtgroen: { hex: "#8FA779", family: "groen" },
  donkergroen: { hex: "#26382A", family: "groen" },
  olijfgroen: { hex: "#6E6B3D", family: "groen" },
  olijf: { hex: "#6E6B3D", family: "groen" },
  mintgroen: { hex: "#A7C9AE", family: "groen" },
  mint: { hex: "#A7C9AE", family: "groen" },
  legergroen: { hex: "#5A6240", family: "groen" },
  // Rood
  rood: { hex: "#8E2B2B", family: "rood" },
  bordeaux: { hex: "#5C1F2B", family: "rood" },
  // Beige / zand — bewust uit elkaar getrokken zodat ze in de kleurenbalk goed
  // te onderscheiden zijn (beige licht/koel, zand donkerder/goudwarm).
  beige: { hex: "#E0D6BE", family: "beige" },
  zand: { hex: "#C6A574", family: "beige" },
  sand: { hex: "#C6A574", family: "beige" },
  champagne: { hex: "#E6D7BC", family: "beige" },
  taupe: { hex: "#A99A85", family: "beige" },
  // Roze / paars
  roze: { hex: "#D7A3AE", family: "roze" },
  lila: { hex: "#B7A6C9", family: "paars" },
  paars: { hex: "#5E3B6E", family: "paars" },
};

const MULTI: Swatch = {
  hex: "#999999",
  family: "multi",
  gradient: "conic-gradient(from 210deg,#8E2B2B,#C9A14A,#3E5240,#2F4A6B,#8E2B2B)",
};

function normalize(name: string): string {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function colorSwatch(name: string): Swatch {
  const n = normalize(name);
  if (!n) return { hex: "#C9C7C2", family: "grijs" };
  if (MAP[n]) return MAP[n];
  if (n.includes("multi") || n.includes("print") || n.includes("dessin")) return MULTI;
  // Woord-voor-woord fallback: pak de eerste bekende kleurterm.
  for (const word of n.split(/[ /-]+/)) {
    if (MAP[word]) return MAP[word];
  }
  // Familie-heuristiek op substring.
  const families: [string, ColorFamily, string][] = [
    ["blauw", "blauw", "#2F4A6B"],
    ["grijs", "grijs", "#8B8B8B"],
    ["zwart", "zwart", "#141414"],
    ["wit", "wit", "#FAFAF7"],
    ["bruin", "bruin", "#6B4A2F"],
    ["groen", "groen", "#3E5240"],
    ["rood", "rood", "#8E2B2B"],
    ["beige", "beige", "#D6C7A8"],
    ["roze", "roze", "#D7A3AE"],
    ["paars", "paars", "#5E3B6E"],
  ];
  for (const [needle, family, hex] of families) {
    if (n.includes(needle)) return { hex, family };
  }
  return { hex: "#C9C7C2", family: "grijs" };
}

export const COLOR_FAMILIES: { key: ColorFamily; label: string; hex: string }[] = [
  { key: "blauw", label: "Blauw", hex: "#2F4A6B" },
  { key: "grijs", label: "Grijs", hex: "#8B8B8B" },
  { key: "zwart", label: "Zwart", hex: "#141414" },
  { key: "wit", label: "Wit", hex: "#FAFAF7" },
  { key: "bruin", label: "Bruin", hex: "#6B4A2F" },
  { key: "beige", label: "Beige", hex: "#D6C7A8" },
  { key: "groen", label: "Groen", hex: "#3E5240" },
  { key: "rood", label: "Rood", hex: "#8E2B2B" },
  { key: "roze", label: "Roze", hex: "#D7A3AE" },
  { key: "paars", label: "Paars", hex: "#5E3B6E" },
  { key: "multi", label: "Multikleur", hex: "#999999" },
];

export function colorFamily(name: string): ColorFamily {
  return colorSwatch(name).family;
}

/** HSL-lichtheid (0..1) uit een hex — voor het ordenen van swatches binnen een familie. */
function hexLightness(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

/**
 * Vaste, logische familie-volgorde voor de kleurenbalk: lichte neutralen → warme
 * kleuren → koele kleuren → donkere neutralen. Zo oogt de balk als een net palet
 * i.p.v. alfabetisch door elkaar (Beige, Groen, Lichtgroen, Zand → Beige, Zand,
 * Lichtgroen, Groen).
 */
const SWATCH_FAMILY_ORDER: ColorFamily[] = [
  "wit", "beige", "geel", "oranje", "rood", "roze", "paars", "blauw", "groen", "bruin", "grijs", "zwart", "multi",
];

/** Sorteersleutel: [familie-index, donkerheid] — groepeert per familie en gaat
 *  binnen een familie van licht → donker. */
export function swatchSortKey(name: string): [number, number] {
  const sw = colorSwatch(name);
  const fi = SWATCH_FAMILY_ORDER.indexOf(sw.family);
  return [fi < 0 ? SWATCH_FAMILY_ORDER.length : fi, sw.gradient ? 0.5 : 1 - hexLightness(sw.hex)];
}

/** Sorteer kleurvarianten op palet-volgorde (familie + licht→donker). Stabiel. */
export function sortBySwatch<T extends { colorName: string }>(items: T[]): T[] {
  return items
    .map((it, i) => ({ it, i, k: swatchSortKey(it.colorName) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.i - b.i)
    .map((x) => x.it);
}
