/**
 * Maat-taxonomie — exact overgenomen uit de Shopify-theme
 * (snippets/variant-picker.liquid). GENTS-confectiematen coderen pasvorm-lengte
 * in het getal:
 *   REGULAR  42–64 (even)   → XXS … 6XL
 *   LONG     88–118 (lengtematen)  → XS … 4XL
 *   SHORT    22–32 (kwartmaten)    → XS … 6XL
 * Overhemd-boordmaten dragen de lettermaat als eerste woord ("M 39/40"); een
 * "7"-suffix ("M7 39/40") = mouwlengte 7 (lang).
 *
 * Voor het FILTER collapsen we elke maat naar zijn lettermaat-rij, zodat de
 * facet ~10 nette buckets toont i.p.v. 44/46/25/98/One/S/M door elkaar.
 */

export type SizeGroup = "regular" | "long" | "short";
export type SizeLayout = "regular-long-short" | "extra-sleeve" | "regular-only";

const ROW_MAP: Record<string, string> = {
  XXS: "XXS", XS: "XS", S: "S", M: "M", "M/L": "M/L", L: "L", XL: "XL",
  XXL: "XXL", "3XL": "3XL", "4XL": "4XL", "5XL": "5XL", "6XL": "6XL",
  // REGULAR
  "42": "XXS", "44": "XS", "46": "S", "48": "M", "50": "M/L", "52": "L",
  "54": "XL", "56": "XXL", "58": "3XL", "60": "4XL", "62": "5XL", "64": "6XL",
  // LONG (lengtematen)
  "88": "XS", "90": "S", "94": "M", "98": "M/L", "102": "L", "106": "XL",
  "110": "XXL", "114": "3XL", "118": "4XL",
  // SHORT (kwartmaten)
  "22": "XS", "23": "S", "24": "M", "25": "M/L", "26": "L", "27": "XL",
  "28": "XXL", "29": "3XL", "30": "4XL", "31": "5XL", "32": "6XL",
};

export const ROW_ORDER = ["XXS", "XS", "S", "M", "M/L", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL"];

const SLEEVE7 = /^[A-Z0-9/]+7$/;

export function sizeToken(value: string): string {
  return String(value || "").trim().split(" ")[0].trim().toUpperCase();
}

/** Lettermaat-rij (de filter-bucket) voor een maatwaarde. */
export function sizeRowLabel(value: string): string {
  const token = sizeToken(value);
  if (!token) return "";
  // Mouwlengte-7 variant ("M7","XL7","3XL7","S7 37/38") → lettermaat zonder de 7.
  if (token.length > 1 && token.endsWith("7")) {
    const base = token.slice(0, -1);
    if (ROW_MAP[base]) return ROW_MAP[base];
  }
  // Colbert met expliciete Long/Short-suffix ("44L","50S","54L") → lettermaat.
  const ls = token.match(/^(\d{2})[LS]$/);
  if (ls) {
    const n = parseInt(ls[1], 10);
    if (n >= 42 && n <= 64 && n % 2 === 0 && ROW_MAP[ls[1]]) return ROW_MAP[ls[1]];
  }
  return ROW_MAP[token] || token;
}

/** In welke kolom (regular/long/short) valt deze maat, gegeven de layout. */
export function sizeGroup(value: string, layout: SizeLayout): SizeGroup {
  const token = sizeToken(value);
  const num = parseInt(token, 10);
  if (layout === "extra-sleeve") {
    if (SLEEVE7.test(token) && Number.isNaN(num)) return "long";
    return "regular";
  }
  if (layout === "regular-only") return "regular";
  if (!Number.isNaN(num)) {
    if (num >= 88 && num <= 118 && num % 2 === 0) return "long";
    if (num >= 22 && num <= 34) return "short";
  }
  return "regular";
}

const REGULAR_ONLY_HG = new Set([
  "truien", "poloshirts", "poloshirt", "schoenen", "shoes", "loafers", "sneakers", "veterschoenen", "laarzen",
  // Accessoires: platte matenlijst (geen Regular/Long/Short — die slaat nergens
  // op bij riemen/dassen; hun maten zijn cm-omtrek of "ONE", geen lichaamslengte).
  "riemen", "riem", "stropdassen", "strikken", "sokken", "bretels", "sjaal", "sjaals",
  "manchetknopen", "dasspelden", "pochet", "cumberband", "accessoires", "ondergoed", "boxershorts",
]);
const SLEEVE_HG = new Set(["overhemden", "shirts"]);

/** Bepaalt de maatlayout o.b.v. hoofdgroep + aanwezige maten (zoals de theme). */
export function sizeLayoutFor(hoofdgroep: string, sizes: string[]): SizeLayout {
  const hg = String(hoofdgroep || "").trim().toLowerCase();
  if (REGULAR_ONLY_HG.has(hg)) return "regular-only";
  if (SLEEVE_HG.has(hg)) return "extra-sleeve";
  let hasLong = false;
  let hasShort = false;
  for (const s of sizes) {
    const n = parseInt(sizeToken(s), 10);
    if (!Number.isNaN(n)) {
      if (n >= 88 && n <= 118) hasLong = true;
      if (n >= 22 && n <= 34) hasShort = true;
    }
  }
  return hasLong || hasShort ? "regular-long-short" : "regular-only";
}

/** Sorteersleutel voor lettermaat-buckets (XXS→6XL, dan One, dan overig). */
export function rowSortIndex(label: string): number {
  const i = ROW_ORDER.indexOf(label);
  if (i >= 0) return i;
  if (label === "ONE" || label.toUpperCase() === "ONE") return 100;
  return 200;
}

export function rowDisplayLabel(label: string): string {
  if (label.toUpperCase() === "ONE") return "Eén maat";
  return label;
}
