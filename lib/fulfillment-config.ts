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

/* ── Feestdagen ───────────────────────────────────────────────────────────
 * Berekend per jaar, niet als handmatige lijst. Een vaste lijst dekte alleen
 * 2026; vanaf 1 januari 2027 zou isHoliday() overal false geven — stil, zonder
 * fout — en zou de site levering beloven op Nieuwjaarsdag en Eerste Kerstdag.
 * De paasgebonden dagen komen uit de Meeus/Butcher-formule (Gregoriaans).
 */

const isoDay = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Eerste Paasdag (Gregoriaans) — Meeus/Butcher. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function plusDays(base: Date, n: number): string {
  const d = new Date(base.getTime() + n * 86400000);
  return isoDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Verzendvrije feestdagen voor één jaar en land (yyyy-mm-dd). */
export function holidaysForYear(year: number, country: string): Set<string> {
  const pasen = easterSunday(year);
  const gedeeld = [
    isoDay(year, 1, 1), // Nieuwjaarsdag
    plusDays(pasen, 1), // Tweede Paasdag
    plusDays(pasen, 39), // Hemelvaartsdag
    plusDays(pasen, 50), // Tweede Pinksterdag
    isoDay(year, 12, 25), // Eerste Kerstdag
  ];
  if (String(country).toUpperCase() === "BE") {
    return new Set([
      ...gedeeld,
      isoDay(year, 5, 1), // Dag van de Arbeid
      isoDay(year, 7, 21), // Nationale feestdag
      isoDay(year, 8, 15), // O.-L.-V. Hemelvaart
      isoDay(year, 11, 1), // Allerheiligen
      isoDay(year, 11, 11), // Wapenstilstand
    ]);
  }
  return new Set([
    ...gedeeld,
    plusDays(pasen, -2), // Goede Vrijdag (veel vervoerders rijden beperkt)
    isoDay(year, 4, 27), // Koningsdag
    isoDay(year, 12, 26), // Tweede Kerstdag
  ]);
}

const _holidayCache = new Map<string, Set<string>>();
function holidaysCached(year: number, country: string): Set<string> {
  const k = `${year}|${country}`;
  let s = _holidayCache.get(k);
  if (!s) {
    s = holidaysForYear(year, country);
    _holidayCache.set(k, s);
  }
  return s;
}

/**
 * Verzendvrije dag? Feestdag van het land van dit filiaal, of een extra
 * sluitingsdag die in de instellingen is opgegeven (vakantiesluiting,
 * verbouwing, personeelsdag) — die gelden voor álle filialen.
 */
export function isHoliday(branchId: string, isoDate: string, extraClosures?: readonly string[]): boolean {
  if (extraClosures?.length && extraClosures.includes(isoDate)) return true;
  const year = Number(String(isoDate).slice(0, 4));
  if (!Number.isFinite(year)) return false;
  return holidaysCached(year, branchCountry(branchId)).has(isoDate);
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
