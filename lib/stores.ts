import storesData from "@/content/stores.json";

export type Store = {
  pageHandle: string;
  title: string;
  city: string;
  address: string;
  phone: string;
  mapsUrl: string;
  hours: Record<string, string>; // dag → "10:00-18:00" (leeg = gesloten)
  today: string;
  /**
   * Coördinaten van het STADSCENTRUM, niet van de deur — nauwkeurig genoeg om
   * winkels op afstand te sorteren ("welke is het dichtst bij?"), maar bewust
   * niet bedoeld voor navigatie: daarvoor staat er een echte maps-link op de
   * winkelpagina.
   */
  lat?: number;
  lng?: number;
};

/**
 * Hemelsbrede afstand in km (Haversine). Voor "welke winkel is het dichtst bij"
 * is dat genoeg: de volgorde van 19 winkels over Nederland verandert niet van
 * een paar honderd meter reisafstand-verschil.
 */
export function afstandKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Winkels gesorteerd op afstand tot een punt. Zonder punt (of zonder coördinaten
 * op de winkel) blijft de bestaande volgorde staan — nooit een willekeurige.
 */
export function storesByDistance<T extends { lat?: number; lng?: number }>(
  list: T[],
  vanaf: { lat: number; lng: number } | null,
): (T & { distanceKm?: number })[] {
  if (!vanaf) return list.map((s) => ({ ...s }));
  return list
    .map((s) => ({
      ...s,
      distanceKm:
        typeof s.lat === "number" && typeof s.lng === "number"
          ? Math.round(afstandKm(vanaf, { lat: s.lat, lng: s.lng }))
          : undefined,
    }))
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
}

export const DAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

/**
 * Hoeveel winkels een klant als "mijn winkel" mag vastleggen. Een klant komt
 * vaak in twee of drie winkels (thuis, werk, familie), maar bij tien betekent
 * "mijn winkel" niets meer: de productpagina wordt een lijstje en het filter
 * filtert bijna niets meer weg. Staat hier omdat zowel de server (cookie,
 * profiel) als het profielformulier in de browser deze grens nodig heeft.
 */
export const MAX_MY_STORES = 5;

export function getStores(): Store[] {
  return storesData as Store[];
}

export function getStoreByPageHandle(handle: string): Store | null {
  return (storesData as Store[]).find((s) => s.pageHandle === handle) ?? null;
}

/** Huidige NL-tijd als { day: 'maandag', minutes: 0-1439 }. */
function nowNL(): { day: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const day = (parts.find((p) => p.type === "weekday")?.value || "").toLowerCase();
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return { day, minutes: hour * 60 + minute };
}

function parseRange(range: string): [number, number] | null {
  const m = String(range || "").match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])];
}

export function currentDayNL(): string {
  return nowNL().day;
}

/**
 * Is de winkel op deze weekdag open? ÉÉN definitie voor de hele codebase.
 *
 * Waarom niet gewoon "staat er tekst": in content/stores.json staat op een
 * gesloten dag het WOORD "gesloten" (Hilversum ma+zo, Delft zo, Antwerpen zo),
 * geen lege string. Een niet-leeg-check las die dagen daardoor als open, en de
 * allocatie stuurde er orders heen met een "vandaag verzonden"-belofte terwijl
 * de deur dicht was. Open = er staat een leesbare tijdrange.
 */
export function isOpenOnDay(hours: Record<string, string> | undefined, dayName: string): boolean {
  return parseRange(hours?.[dayName] || "") !== null;
}

/** Sluitingstijd in MINUTEN na middernacht, of null als de winkel dan dicht is.
 *  Minuten en niet uren, zodat een marge ervan afgetrokken kan worden vóór er
 *  afgerond wordt — anders kost een marge van een half uur bij een winkel die om
 *  17:30 sluit een vol uur cutoff. */
export function closingMinutesOnDay(hours: Record<string, string> | undefined, dayName: string): number | null {
  const r = parseRange(hours?.[dayName] || "");
  return r ? r[1] : null;
}

/** Sluitingsuur (0-24), naar beneden afgerond: 17:30 → 17, nooit 18. */
export function closingHourOnDay(hours: Record<string, string> | undefined, dayName: string): number | null {
  const m = closingMinutesOnDay(hours, dayName);
  return m == null ? null : Math.floor(m / 60);
}

/** Open op dit moment? + de dag en tijden van vandaag. */
export function openStatus(store: Store): { open: boolean; today: string; todayRange: string | null } {
  const { day, minutes } = nowNL();
  const range = store.hours[day] || "";
  const todayRange = range.trim() || null;
  const parsed = parseRange(range);
  const open = Boolean(parsed && minutes >= parsed[0] && minutes < parsed[1]);
  return { open, today: day, todayRange };
}

/**
 * Afhaal-info voor een winkel (op stad): is 'ie nu open, en een kort label
 * ("Open tot 18:00" / "Opent om 10:00" / "Vandaag gesloten"). Voor click &
 * collect, zodat de klant weet of hij er vandaag nog terecht kan.
 */
export function pickupInfoByCity(city: string): { openNow: boolean; label: string } | null {
  const store = (storesData as Store[]).find((s) => s.city.toLowerCase() === city.toLowerCase());
  if (!store) return null;
  const { day, minutes } = nowNL();
  const range = (store.hours[day] || "").trim();
  const parsed = parseRange(range);
  if (!parsed) return { openNow: false, label: "Vandaag gesloten" };
  const [start, end] = parsed;
  if (minutes < start) return { openNow: false, label: `Opent om ${fmtMin(start)}` };
  if (minutes >= end) return { openNow: false, label: "Vandaag gesloten" };
  return { openNow: true, label: `Open tot ${fmtMin(end)}` };
}

function fmtMin(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, "0")}`;
}

export function mapsEmbedUrl(store: Store): string {
  const q = encodeURIComponent(`${store.address}, ${store.city}`);
  return `https://www.google.com/maps?q=${q}&output=embed`;
}

export function mapsLinkUrl(store: Store): string {
  if (store.mapsUrl) return store.mapsUrl;
  const q = encodeURIComponent(`GENTS ${store.city}, ${store.address}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
