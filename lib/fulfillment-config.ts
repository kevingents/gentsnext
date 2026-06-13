/**
 * Fulfilment-configuratie — WELKE filialen mogen leveren en hoe ze geprioriteerd
 * worden. Bewust hier als config (geen secret) zodat het makkelijk aan te passen
 * is; env-vars overschrijven de defaults. Later verhuisbaar naar een
 * Instellingen-UI.
 *
 * Bron-data: SRS-voorraadblob (filiaalNummer). De магazijnen leveren bij voorkeur
 * eerst (retail-voorraad bewaren we voor de winkelklant), retail kan bijspringen,
 * en alle overige locaties (klachten/afkeur/lost&found/showroom/…) zijn
 * uitgesloten van levering.
 */

/** Magazijnen — leveren eerst, geen veiligheidsvoorraad. Volgorde = prioriteit. */
export const WAREHOUSE_BRANCHES: string[] = parseList(
  process.env.GENTS_WAREHOUSE_BRANCHES,
  ["99", "90", "704", "705", "98"]
);

/** Retail-filialen met openingstijden — mogen bijspringen, maar beschermd. */
export const RETAIL_BRANCHES: string[] = parseList(
  process.env.GENTS_RETAIL_BRANCHES,
  ["1", "2", "3", "4", "5", "8", "10", "12", "13", "14", "15", "16", "17", "18", "19", "20", "22", "23", "50"]
);

/** Hoeveel stuks een retail-filiaal MINIMAAL houdt (niet de laatste verkopen). */
export const RETAIL_SAFETY_STOCK = numEnv(process.env.GENTS_RETAIL_SAFETY_STOCK, 1);
export const WAREHOUSE_SAFETY_STOCK = numEnv(process.env.GENTS_WAREHOUSE_SAFETY_STOCK, 0);

/** Verzend-cutoff: vóór dit uur (NL-tijd) besteld = vandaag verzonden. */
export const CARRIER_CUTOFF_HOUR = numEnv(process.env.GENTS_CARRIER_CUTOFF_HOUR, 16);

/**
 * Map branchId → stad, om openingstijden uit content/stores.json te vinden.
 * Magazijnen hebben geen winkel-openingstijden (verzenden op werkdagen).
 */
export const BRANCH_CITY: Record<string, string> = {
  "1": "Almere", "2": "Amersfoort", "3": "Arnhem", "4": "Breda", "5": "Delft",
  "8": "Enschede", "10": "Groningen", "12": "Hilversum", "13": "Leiden",
  "14": "Maastricht", "15": "Amsterdam", "16": "Nijmegen", "17": "Tilburg",
  "18": "Utrecht", "19": "Zoetermeer", "20": "Rotterdam", "22": "Zwolle",
  "23": "Den Bosch", "50": "Antwerpen",
};

export function isWarehouse(branchId: string): boolean {
  return WAREHOUSE_BRANCHES.includes(branchId);
}
export function isRetail(branchId: string): boolean {
  return RETAIL_BRANCHES.includes(branchId);
}
/** Mag dit filiaal leveren? (allowlist: alleen magazijn ∪ retail). */
export function isFulfillable(branchId: string): boolean {
  return isWarehouse(branchId) || isRetail(branchId);
}
/** Hogere score = eerder kiezen. Magazijn ruim boven retail. */
export function branchPriority(branchId: string): number {
  const w = WAREHOUSE_BRANCHES.indexOf(branchId);
  if (w >= 0) return 1000 - w; // 99 = 1000, 90 = 999, …
  const r = RETAIL_BRANCHES.indexOf(branchId);
  if (r >= 0) return 100 - r;
  return 0;
}
export function safetyStockFor(branchId: string): number {
  return isWarehouse(branchId) ? WAREHOUSE_SAFETY_STOCK : RETAIL_SAFETY_STOCK;
}

function parseList(raw: string | undefined, fallback: string[]): string[] {
  const v = (raw || "").trim();
  if (!v) return fallback;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}
function numEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && raw ? n : fallback;
}
