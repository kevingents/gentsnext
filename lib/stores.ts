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
};

export const DAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

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
