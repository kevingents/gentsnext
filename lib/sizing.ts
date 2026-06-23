/**
 * Maatlogica voor GENTS-herenmode.
 *
 * Twee verantwoordelijkheden:
 *  1. Maten herkennen & correct sorteren (de catalogus mengt confectiematen,
 *     boordmaten, lengtematen en S–XXL door elkaar).
 *  2. Maatadvies: lichaamsmaten → aanbevolen confectie/boord/pantalonmaat.
 *
 * NL-confectie (geverifieerd domeinkennis, verfijnd met UX-onderzoek):
 *  - Jasje/colbert 44–60 (even): jasjemaat ≈ borstomvang(cm) / 2.
 *    Maat 50 = 100 cm borst.
 *  - Lengtematen 90–118 (stap 4) = lange/slanke maten; ≈ jasjemaat × 2.
 *    Maat 98 ≈ jasje 49 in een lange pasvorm.
 *  - Overhemd boordmaat = halsomvang(cm): 39/40 = M, 41/42 = L, enz.
 *    "7"-suffix = extra lengte (langere pasvorm voor lange mannen).
 *  - Pantalon-tailleband 25–29 = aparte lijn (chino/jeans-achtig maatnummer).
 *  - Drop: pantalonmaat ligt doorgaans 6 onder de jasjemaat (drop 6).
 *
 * NB: de jasjemaat + boordmaat worden gegrond op de ECHTE GENTS-maattabel
 * (lib/size-chart, bron Faslet) i.p.v. de vuistregel borst/2 — GENTS valt anders
 * (maat 50 = 107 cm borst). De tabel is leidend; de formule is enkel fallback.
 */
import { sizeByChest, boordByChest } from "@/lib/size-chart";

export type SizeSystem =
  | "jacket" // 44–60 even (colbert/pak)
  | "trouser-length" // 90–118 (lange/lengtematen)
  | "trouser-waist" // 25–29
  | "shirt-collar" // S 37/38 … 4XL 49/50
  | "letter" // S–XXL
  | "onesize" // One
  | "numeric" // overige getallen
  | "other";

/** Classificeer welk maatsysteem een set varianten gebruikt. */
export function classifySizeSystem(sizes: string[]): SizeSystem {
  const clean = sizes.map((s) => String(s || "").trim()).filter(Boolean);
  if (!clean.length) return "other";
  const lc = clean.map((s) => s.toLowerCase());

  if (lc.every((s) => s === "one" || s === "one size" || s === "os")) return "onesize";
  // Boordmaat-patroon "37/38" of "XL 43/44"
  if (clean.some((s) => /\d{2}\/\d{2}/.test(s))) return "shirt-collar";
  const nums = clean.map((s) => Number(s)).filter((n) => Number.isFinite(n));
  if (nums.length >= clean.length * 0.6) {
    const max = Math.max(...nums);
    const min = Math.min(...nums);
    if (min >= 44 && max <= 64 && nums.every((n) => n % 2 === 0)) return "jacket";
    if (min >= 80 && max <= 130) return "trouser-length";
    if (min >= 20 && max <= 40) return "trouser-waist";
    return "numeric";
  }
  if (lc.every((s) => /^(xxs|xs|s|m|l|xl|xxl|3xl|4xl|5xl)$/.test(s))) return "letter";
  return "other";
}

const LETTER_ORDER = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "3xl", "4xl", "5xl"];

/** Sorteersleutel zodat maten in natuurlijke volgorde staan, niet alfabetisch. */
export function sizeSortKey(size: string): number {
  const s = String(size || "").trim();
  const lc = s.toLowerCase();
  if (lc === "one" || lc === "one size") return -1;
  // "S 37/38" → sorteer op het boordgetal
  const collar = s.match(/(\d{2})\/\d{2}/);
  if (collar) return Number(collar[1]);
  const letterIdx = LETTER_ORDER.indexOf(lc.replace(/\s.*$/, ""));
  if (letterIdx >= 0) return 1000 + letterIdx;
  const num = Number(s);
  if (Number.isFinite(num)) return num;
  return 9999;
}

export function sortSizes<T extends { size: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => sizeSortKey(a.size) - sizeSortKey(b.size));
}

/* ─────────────────────────── Maatadvies-engine ─────────────────────────── */

export type FitPreference = "slim" | "regular" | "comfort";

export type SizeAdviceInput = {
  heightCm: number;
  weightKg: number;
  fit?: FitPreference;
  // Optionele directe metingen (overschrijven schattingen).
  chestCm?: number;
  waistCm?: number;
  neckCm?: number;
  age?: number;
};

export type CategoryAdvice = {
  size: string;
  range?: string; // bv. "48–50" bij twijfel
  confidence: "hoog" | "gemiddeld" | "laag";
  note?: string;
};

export type SizeAdvice = {
  jacket: CategoryAdvice; // colbert/pak (44–60)
  trouserLength?: CategoryAdvice; // lengtemaat indien lang
  shirt: CategoryAdvice; // boordmaat
  estimatedChestCm: number;
  estimatedNeckCm: number;
  tall: boolean;
};

const clampEven = (n: number, lo: number, hi: number) => {
  let v = Math.round(n);
  if (v % 2 !== 0) v += 1;
  return Math.max(lo, Math.min(hi, v));
};

/**
 * Schat borstomvang uit lengte + gewicht + pasvoorkeur. Eerlijke heuristiek:
 * gebaseerd op BMI-band; metingen overschrijven dit altijd.
 */
function estimateChest(input: SizeAdviceInput): number {
  if (input.chestCm && input.chestCm > 60) return input.chestCm;
  const { heightCm, weightKg } = input;
  const bmi = weightKg / Math.pow(heightCm / 100, 2);
  // Basis: borst ≈ gewicht-gedreven. Empirische band voor volwassen mannen.
  let chest = 76 + (weightKg - 60) * 0.62 + (bmi - 23) * 1.1;
  // Lengtecorrectie: langere mannen dragen breder bij gelijk gewicht net iets smaller.
  chest += (175 - heightCm) * 0.08;
  return Math.round(Math.max(82, Math.min(130, chest)));
}

function estimateNeck(chestCm: number, input: SizeAdviceInput): number {
  if (input.neckCm && input.neckCm > 30) return input.neckCm;
  // Halsomvang correleert met borst: ~neck = chest*0.38 + 0.5.
  return Math.round(chestCm * 0.385 + 1);
}

/** Boordmaat (even getal) → label zoals in de catalogus ("39/40"). */
function collarLabel(neckCm: number): string {
  const even = neckCm % 2 === 0 ? neckCm : neckCm + 1;
  const lo = even - 1;
  return `${lo}/${even}`;
}

export function recommendSizes(input: SizeAdviceInput): SizeAdvice {
  const fit: FitPreference = input.fit || "regular";
  const measuredChest = Boolean(input.chestCm && input.chestCm > 60);
  const chest = estimateChest(input);
  const neck = estimateNeck(chest, input);
  const tall = input.heightCm >= 188;

  // Colbert/pak: grond op de GENTS-maattabel (autoritair), niet op borst/2.
  const cb = sizeByChest("Colberts (Standaard)", chest);
  const jacket = cb ? Number(cb.size) : clampEven(chest / 2, 42, 64);

  // Confidence: hoog alleen bij een gemeten borst die netjes in een maat valt.
  const jacketConfidence: CategoryAdvice["confidence"] =
    measuredChest && cb && cb.distanceCm <= 2
      ? "hoog"
      : input.heightCm && input.weightKg
        ? "gemiddeld"
        : "laag";

  // De tabel geeft je lichaamsmaat; comfort → overweeg een maat ruimer, en bij
  // een schatting tonen we een twijfelband.
  const jacketRange =
    fit === "comfort"
      ? `${jacket}–${Math.min(64, jacket + 2)}`
      : !measuredChest
        ? `${Math.max(42, jacket - 2)}–${jacket}`
        : undefined;

  // Overhemd-boordmaat uit de tabel (borst → boord), niet uit een formule.
  const bd = boordByChest(chest);
  const shirtSize = bd ? bd.boordCm.replace("-", "/") : collarLabel(neck);

  const advice: SizeAdvice = {
    estimatedChestCm: chest,
    estimatedNeckCm: neck,
    tall,
    jacket: {
      size: String(jacket),
      range: jacketRange,
      confidence: jacketConfidence,
      note:
        fit === "slim"
          ? "Slim fit valt strakker — dit is je lichaamsmaat."
          : fit === "comfort"
            ? "Comfort fit zit ruimer — bij twijfel een maat groter."
            : undefined,
    },
    shirt: {
      size: shirtSize,
      confidence: measuredChest || input.neckCm ? "hoog" : "gemiddeld",
      note: tall ? "Lange pasvorm? Kies de 7-variant voor extra lengte." : undefined,
    },
  };

  if (tall) {
    // Lengtemaat ≈ jasjemaat × 2 (90–118 band).
    const lengte = Math.max(90, Math.min(118, Math.round((jacket * 2) / 4) * 4));
    advice.trouserLength = {
      size: String(lengte),
      confidence: jacketConfidence,
      note: "Lange/lengtemaat — meer lengte in jasje en pijp.",
    };
  }

  return advice;
}

/**
 * Geeft, gegeven het maatsysteem van een product en een berekend advies, de
 * best passende beschikbare maat-string terug (voor "vind mijn maat").
 */
export function adviceForSystem(
  system: SizeSystem,
  advice: SizeAdvice
): { size: string; label: string } | null {
  switch (system) {
    case "jacket":
      return { size: advice.jacket.size, label: `Jouw colbertmaat: ${advice.jacket.size}` };
    case "trouser-length":
      return advice.trouserLength
        ? { size: advice.trouserLength.size, label: `Jouw lengtemaat: ${advice.trouserLength.size}` }
        : null;
    case "shirt-collar":
      return { size: advice.shirt.size, label: `Jouw boordmaat: ${advice.shirt.size}` };
    default:
      return null;
  }
}
