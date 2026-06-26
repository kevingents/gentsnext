import type { Settings } from "@/lib/settings";

/**
 * Fulfilment-classificatie — WELKE filialen mogen leveren en hoe ze
 * geprioriteerd worden. Dit is technische/statische config (welk filiaalnummer
 * is een magazijn); de BUSINESS-knoppen (cutoffs, veiligheidsvoorraad, toeslag,
 * levertijd) staan in de instelbare settings-store (lib/settings) en zijn via
 * /account/instellingen te bewerken.
 *
 * Bron-data: SRS-voorraadblob (filiaalNummer). Magazijnen leveren bij voorkeur
 * eerst (retail-voorraad bewaren we voor de winkelklant), retail kan bijspringen,
 * en alle overige locaties (klachten/afkeur/lost&found/showroom/…) zijn
 * uitgesloten van levering.
 */

/** Magazijnen — leveren eerst. Volgorde = prioriteit. */
export const WAREHOUSE_BRANCHES: string[] = parseList(process.env.GENTS_WAREHOUSE_BRANCHES, ["99", "90", "704", "705", "98"]);

/** Retail-filialen met openingstijden — mogen bijspringen, maar beschermd. */
export const RETAIL_BRANCHES: string[] = parseList(
  process.env.GENTS_RETAIL_BRANCHES,
  ["1", "2", "3", "4", "5", "8", "10", "12", "13", "14", "15", "16", "17", "18", "19", "20", "22", "23", "50"]
);

/** Map branchId → stad, om openingstijden uit content/stores.json te vinden. */
export const BRANCH_CITY: Record<string, string> = {
  "1": "Almere", "2": "Amersfoort", "3": "Arnhem", "4": "Breda", "5": "Delft",
  "8": "Enschede", "10": "Groningen", "12": "Hilversum", "13": "Leiden",
  "14": "Maastricht", "15": "Amsterdam", "16": "Nijmegen", "17": "Tilburg",
  "18": "Utrecht", "19": "Zoetermeer", "20": "Rotterdam", "22": "Zwolle",
  "23": "Den Bosch", "50": "Antwerpen",
};

/** Land per filiaal — Antwerpen (50) = BE, rest NL. Voor cross-border-afweging. */
export const COUNTRY_OF_BRANCH: Record<string, string> = { "50": "BE" };
export function branchCountry(branchId: string): string {
  return COUNTRY_OF_BRANCH[branchId] || "NL";
}

/** Feestdagen NL+BE (yyyy-mm-dd) waarop NIET verzonden wordt. */
export const SHIPPING_HOLIDAYS: Record<string, Set<string>> = {
  NL: new Set(["2026-01-01", "2026-04-03", "2026-04-06", "2026-04-27", "2026-05-14", "2026-05-25", "2026-12-25", "2026-12-26"]),
  BE: new Set(["2026-01-01", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-25", "2026-07-21", "2026-08-15", "2026-11-01", "2026-11-11", "2026-12-25"]),
};
export function isHoliday(branchId: string, isoDate: string): boolean {
  return SHIPPING_HOLIDAYS[branchCountry(branchId)]?.has(isoDate) ?? false;
}

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

/* ── Settings-afhankelijke helpers (instelbaar in de backend) ────────────── */
export function safetyStockFor(branchId: string, s: Settings): number {
  return isWarehouse(branchId) ? s.warehouseSafetyStock : s.retailSafetyStock;
}
export function cutoffHourFor(branchId: string, s: Settings, dayName?: string): number {
  if (s.branchCutoffs && s.branchCutoffs[branchId] != null) return s.branchCutoffs[branchId];
  const wh = isWarehouse(branchId);
  // Per-weekdag-override (bv. magazijn vrijdag 16:00) gaat vóór het basisuur.
  const byDay = wh ? s.warehouseCutoffByDay : s.storeCutoffByDay;
  if (dayName && byDay && byDay[dayName] != null) return byDay[dayName];
  return wh ? s.warehouseCutoffHour : s.storeCutoffHour;
}

/** Datum-onderdelen in Amsterdam-tijd (zodat cutoff-uren lokaal kloppen, los van server-UTC). */
function amsterdamParts(d: Date): { y: number; mo: number; da: number; h: number; mi: number; dayName: string } {
  const f = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "long",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  return { y: +p.year, mo: +p.month, da: +p.day, h: +p.hour === 24 ? 0 : +p.hour, mi: +p.minute, dayName: String(p.weekday || "").toLowerCase() };
}

function isShipDay(branchId: string, y: number, mo: number, da: number): boolean {
  const dow = new Date(Date.UTC(y, mo - 1, da, 12)).getUTCDay(); // 0=zo, 6=za
  if (dow === 0 || dow === 6) return false;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  return !isHoliday(branchId, iso);
}

/**
 * Pick-deadline voor een order: vóór de cutoff besteld → vandaag de deur uit,
 * anders de eerstvolgende verzenddag. Geeft een leesbaar label + of 'ie al te
 * laat is (alles in Amsterdam-tijd; weekend/feestdagen overgeslagen).
 */
/** Binnen hoeveel minuten vóór de cutoff een order "bijna te laat" (oranje) is. */
const SOON_WINDOW_MIN = 120;

export function computePickDeadline(createdAt: Date, branchId: string, s: Settings, now: Date): { pickByLabel: string; overdue: boolean; soon: boolean; sameDay: boolean } {
  const c = amsterdamParts(createdAt);
  const cutoff = cutoffHourFor(branchId, s, c.dayName);
  let y = c.y, mo = c.mo, da = c.da;
  // Ná de cutoff besteld → schuif naar de volgende dag.
  if (c.h >= cutoff) {
    const nx = new Date(Date.UTC(y, mo - 1, da, 12)); nx.setUTCDate(nx.getUTCDate() + 1);
    y = nx.getUTCFullYear(); mo = nx.getUTCMonth() + 1; da = nx.getUTCDate();
  }
  // Sla weekend/feestdagen over tot de eerstvolgende verzenddag.
  for (let i = 0; i < 9 && !isShipDay(branchId, y, mo, da); i++) {
    const nx = new Date(Date.UTC(y, mo - 1, da, 12)); nx.setUTCDate(nx.getUTCDate() + 1);
    y = nx.getUTCFullYear(); mo = nx.getUTCMonth() + 1; da = nx.getUTCDate();
  }
  const deadlineNum = y * 1e8 + mo * 1e6 + da * 1e4 + cutoff * 100;
  const n = amsterdamParts(now);
  const nowNum = n.y * 1e8 + n.mo * 1e6 + n.da * 1e4 + n.h * 100 + n.mi;
  const overdue = nowNum > deadlineNum;
  const sameDay = y === n.y && mo === n.mo && da === n.da;
  // "Bijna te laat" (oranje): deadline is vandaag en nog ≤ SOON_WINDOW_MIN minuten te gaan.
  const minutesLeft = sameDay ? cutoff * 60 - (n.h * 60 + n.mi) : 9999;
  const soon = !overdue && minutesLeft >= 0 && minutesLeft <= SOON_WINDOW_MIN;
  const dayLabel = sameDay ? "vandaag" : `${String(da).padStart(2, "0")}-${String(mo).padStart(2, "0")}`;
  return { pickByLabel: `${dayLabel} ${String(cutoff).padStart(2, "0")}:00`, overdue, soon, sameDay };
}

/** Winkelnaam ("GENTS Amersfoort") → branchId, voor de cutoff-bepaling. */
export function branchIdForStoreName(name: string): string {
  const city = String(name || "").replace(/^gents\s+/i, "").trim().toLowerCase();
  return Object.keys(BRANCH_CITY).find((id) => BRANCH_CITY[id].toLowerCase() === city) || "store";
}

function parseList(raw: string | undefined, fallback: string[]): string[] {
  const v = (raw || "").trim();
  if (!v) return fallback;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}
