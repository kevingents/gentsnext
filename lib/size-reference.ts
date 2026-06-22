import { recommendSizes, type FitPreference, type CategoryAdvice } from "@/lib/sizing";

/**
 * "Ken je je maat al?" — vertaalt een bekende confectie-/merkmaat naar een
 * indicatief GENTS-advies. We mappen de merkmaat naar een borstomvang (cm) en
 * voeden die in de bestaande, geteste maatlogica (jasje ≈ borst/2, boord, drop 6).
 *
 * BELANGRIJK: merkmaten zijn inconsistent (vanity sizing). Dit is een INDICATIE —
 * de betrouwbaarheid wordt bewust verlaagd en we raden aan te verfijnen met
 * lengte + gewicht. Confectie-systemen die wél standaard zijn (EU-jasje 48/50/52,
 * boord in cm) gaan 1-op-1.
 */
export const REFERENCE_BRANDS = [
  { key: "zara", label: "Zara" },
  { key: "hm", label: "H&M" },
  { key: "suitsupply", label: "Suitsupply" },
  { key: "we-ca", label: "WE / C&A" },
] as const;
export type ReferenceBrand = (typeof REFERENCE_BRANDS)[number]["key"];

export const REFERENCE_LETTERS = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export type ReferenceLetter = (typeof REFERENCE_LETTERS)[number];

// Borstomvang (cm) van een "M" per merk; high-street loopt slanker dan tailoring.
const BRAND_M_CHEST: Record<ReferenceBrand, number> = { zara: 98, hm: 98, suitsupply: 100, "we-ca": 102 };
// Stap t.o.v. M (≈6 cm per maat).
const LETTER_OFFSET: Record<ReferenceLetter, number> = { XS: -12, S: -6, M: 0, L: 6, XL: 12, XXL: 18 };

export function chestFromReference(brand: ReferenceBrand, letter: ReferenceLetter): number {
  return (BRAND_M_CHEST[brand] ?? 100) + (LETTER_OFFSET[letter] ?? 0);
}

export type ReferenceAdvice = {
  chestCm: number;
  colbert: CategoryAdvice;
  overhemd: CategoryAdvice;
  broek: CategoryAdvice;
};

/** Verlaag 'hoog' → 'gemiddeld' (merk-referentie is nooit zo zeker als een meting). */
function cap(c: CategoryAdvice["confidence"]): CategoryAdvice["confidence"] {
  return c === "hoog" ? "gemiddeld" : c;
}

export function referenceAdvice(brand: ReferenceBrand, letter: ReferenceLetter, fit: FitPreference = "regular"): ReferenceAdvice {
  const chestCm = chestFromReference(brand, letter);
  // height/weight zijn placeholders — chestCm is leidend in recommendSizes.
  const adv = recommendSizes({ heightCm: 182, weightKg: 82, chestCm, fit });
  const jacketNum = Number(adv.jacket.size) || 50;
  const waist = Math.max(28, jacketNum - 6); // drop 6
  return {
    chestCm,
    colbert: { ...adv.jacket, confidence: cap(adv.jacket.confidence) },
    overhemd: { ...adv.shirt, confidence: cap(adv.shirt.confidence) },
    broek: { size: String(waist), confidence: "laag", note: "Pantalon ≈ colbert − 6 (drop 6). Controleer je taille voor zekerheid." },
  };
}
