import type { Settings } from "@/lib/settings";
import { getStores, isOpenOnDay, closingMinutesOnDay } from "@/lib/stores";

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
/**
 * Verkoopkanaal voor een voorraadberekening.
 *
 * "web"   — een klant koopt op afstand. De veiligheidsmarge beschermt hier tegen
 *           een misteltelling of een displaystuk: verkoop je het laatste stuk dat
 *           er niet blijkt te zijn, dan volgt een annulering bij een klant die
 *           het schap nooit gezien heeft.
 * "store" — winkels onderling / de kassa. De verkoper staat bij het rek en kan
 *           het artikel pakken. Kevin, 6 aug: "mag eraf voor winkels onderling" —
 *           88,4% van de winkelvoorraadregels heeft 1 of 2 stuks, dus met een
 *           marge van 2 weigerde de kassa vrijwel elke klantbestelling terwijl
 *           het artikel gewoon hing.
 *
 * Default is BEWUST "web": elke bestaande aanroep houdt daarmee exact het gedrag
 * dat 'ie had, en een winkel-pad meldt zichzelf expliciet aan.
 */
export type StockChannel = "web" | "store";

export function safetyStockFor(branchId: string, s: Settings, channel: StockChannel = "web"): number {
  if (channel === "store") return s.storeChannelSafetyStock;
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

const WEEKDAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

/** Openingstijden per stad — stores.json is statisch, dus één keer opbouwen. */
let _hoursByCity: Map<string, Record<string, string>> | null = null;
function hoursForBranch(branchId: string): Record<string, string> | undefined {
  if (!_hoursByCity) {
    _hoursByCity = new Map();
    for (const s of getStores()) _hoursByCity.set(s.city.toLowerCase(), s.hours);
  }
  const city = BRANCH_CITY[branchId];
  return city ? _hoursByCity.get(city.toLowerCase()) : undefined;
}

/**
 * Kan dit filiaal op deze dag een pakket de deur uit doen? ÉÉN definitie voor de
 * allocatie (welke winkel krijgt de order + wat beloven we de klant) én de
 * pick-deadline die de winkel ziet. Liepen die uiteen, dan kreeg de klant
 * "zaterdag verzonden" terwijl de winkellijst "uiterlijk maandag" toonde.
 */
export function isDispatchDay(branchId: string, dayName: string, isoDate: string, s: Settings): boolean {
  if (isHoliday(branchId, isoDate, s.extraClosureDates)) return false;
  if (dayName === "zondag" && !s.dispatchOnSunday) return false;
  if (isWarehouse(branchId)) return dayName !== "zaterdag" && dayName !== "zondag";
  if (dayName === "zaterdag" && !s.dispatchOnSaturdayStores) return false;
  const hours = hoursForBranch(branchId);
  // Onbekende stad → geen openingstijden bekend; val terug op werkdagen.
  if (!hours) return dayName !== "zaterdag" && dayName !== "zondag";
  return isOpenOnDay(hours, dayName);
}

/**
 * Effectieve cutoff (uur) — de ingestelde cutoff, maar voor een winkel nooit
 * later dan haar sluitingstijd min de overdrachtsmarge. Met de basiscutoff van
 * 23:00 beloofde de site anders 's avonds "vandaag verzonden" voor een winkel
 * die om 17:30 dichtging, precies in de piek-besteluren.
 */
export function effectiveCutoffHour(branchId: string, dayName: string, s: Settings): number {
  const ingesteld = cutoffHourFor(branchId, s, dayName);
  if (isWarehouse(branchId)) return ingesteld;
  const sluitMin = closingMinutesOnDay(hoursForBranch(branchId), dayName);
  if (sluitMin == null) return ingesteld;
  /* In MINUTEN rekenen en pas aan het eind afronden. Eerst het sluitingsuur
     afronden en er daarna hele uren marge vanaf trekken kostte bij een winkel
     die om 17:30 sluit een vol uur extra (17:30 − 30 min gaf 16:00 i.p.v. 17:00). */
  const marge = Math.max(0, Math.round(Number(s.storeHandoverMinutes) || 0));
  return Math.max(0, Math.min(ingesteld, Math.floor((sluitMin - marge) / 60)));
}

function isShipDay(branchId: string, y: number, mo: number, da: number, s: Settings): boolean {
  const dow = new Date(Date.UTC(y, mo - 1, da, 12)).getUTCDay(); // 0=zo, 6=za
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  return isDispatchDay(branchId, WEEKDAGEN[dow], iso, s);
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
  /* Zelfde cutoff als de allocatie gebruikte toen de klant z'n belofte kreeg —
     anders toont de winkellijst "uiterlijk 23:00" terwijl de site 17:00 beloofde. */
  let y = c.y, mo = c.mo, da = c.da;
  if (c.h >= effectiveCutoffHour(branchId, c.dayName, s)) {
    const nx = new Date(Date.UTC(y, mo - 1, da, 12)); nx.setUTCDate(nx.getUTCDate() + 1);
    y = nx.getUTCFullYear(); mo = nx.getUTCMonth() + 1; da = nx.getUTCDate();
  }
  // Sla dichte dagen/feestdagen over tot de eerstvolgende verzenddag.
  for (let i = 0; i < 9 && !isShipDay(branchId, y, mo, da, s); i++) {
    const nx = new Date(Date.UTC(y, mo - 1, da, 12)); nx.setUTCDate(nx.getUTCDate() + 1);
    y = nx.getUTCFullYear(); mo = nx.getUTCMonth() + 1; da = nx.getUTCDate();
  }
  // De deadline valt op de gevonden dag, dus met de cutoff VAN die dag.
  const deadlineDag = WEEKDAGEN[new Date(Date.UTC(y, mo - 1, da, 12)).getUTCDay()];
  const cutoff = effectiveCutoffHour(branchId, deadlineDag, s);
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
