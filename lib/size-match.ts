import { sizeRowLabel } from "@/lib/size-taxonomy";

/**
 * "Shop in jouw maat" — koppelt de in het profiel opgeslagen maten aan een
 * product/categorie. Per hoofdgroep weten we welk profielveld telt (colbert,
 * broek, overhemd, schoen) en vertalen we de bewaarde maat naar de
 * filter-bucket (size_label) zodat hij matcht met de PLP-facetten.
 *
 * Bewust géén mapping voor losse lettermaten (truien/polo's): een colbertmaat
 * "50" valt tussen M en L en zou daar verkeerd voorselecteren.
 */

export type SizeCategory = "suit" | "trouser" | "shirt" | "shoe";
type SizeField = "colbert" | "broek" | "overhemd" | "schoen";

const RULES: { cat: SizeCategory; field: SizeField; re: RegExp }[] = [
  { cat: "shoe", field: "schoen", re: /schoen|shoe|loafer|sneaker|veter|laars|laarz|instap|mocassin|boot/i },
  { cat: "shirt", field: "overhemd", re: /overhemd|^shirts?$/i },
  { cat: "trouser", field: "broek", re: /broek|pantalon|chino|jeans/i },
  { cat: "suit", field: "colbert", re: /colbert|gilet|blazer|smoking|pak/i },
];

export type MySize = { category: SizeCategory; field: SizeField; raw: string; row: string };

/** Welke maat-categorie hoort bij deze hoofdgroep (of null). */
export function sizeCategoryFor(hoofdgroep: string): SizeCategory | null {
  const hg = String(hoofdgroep || "");
  return RULES.find((r) => r.re.test(hg))?.cat ?? null;
}

/**
 * Alle filter-buckets (size_label) die bij het maatprofiel van de klant horen —
 * voor "Nieuw in jouw maat": new arrivals met een variant op voorraad in een van
 * deze maten. Vertaalt de bewaarde maten (colbert/broek/overhemd/schoen) naar de
 * PLP-facet-buckets via sizeRowLabel.
 */
export function mySizeBuckets(profile: unknown): string[] {
  if (!profile || typeof profile !== "object") return [];
  const p = profile as Record<string, unknown>;
  const out = new Set<string>();
  for (const field of ["colbert", "broek", "overhemd", "schoen"] as const) {
    const raw = String(p[field] ?? "").trim();
    if (!raw) continue;
    const bucket = sizeRowLabel(raw);
    if (bucket) out.add(bucket);
  }
  return [...out];
}

/**
 * De voor deze hoofdgroep relevante opgeslagen maat van de klant.
 * `raw` = exacte bewaarde maat (bv. "50"), `row` = filter-bucket (bv. "M/L").
 */
export function resolveMySize(hoofdgroep: string, profile: unknown): MySize | null {
  if (!profile || typeof profile !== "object") return null;
  const rule = RULES.find((r) => r.re.test(String(hoofdgroep || "")));
  if (!rule) return null;
  const raw = String((profile as Record<string, unknown>)[rule.field] ?? "").trim();
  if (!raw) return null;
  return { category: rule.cat, field: rule.field, raw, row: sizeRowLabel(raw) };
}
