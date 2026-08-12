import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appointments } from "@/db/schema";
import { getStores } from "@/lib/stores";
import { getSettings } from "@/lib/settings";

/**
 * Klantafspraken (trouwconsult voorop). De klant vraagt via /afspraak een
 * adviesmoment aan in een winkel; de winkel leest en beheert de aanvragen via
 * de core-API (/api/core/afspraken). Bewust een DAGDEEL i.p.v. een tijdslot:
 * de winkel bevestigt zelf het exacte tijdstip (geen agenda-koppeling in de MVP).
 */

export const APPOINTMENT_TYPES = ["trouwconsult", "pasafspraak", "personal-shopping"] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const DAGDELEN = ["ochtend", "middag", "avond", "geen-voorkeur"] as const;
export type Dagdeel = (typeof DAGDELEN)[number];

export const APPOINTMENT_STATUSES = ["nieuw", "bevestigd", "afgerond", "no-show", "geannuleerd"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Afgesproken tijdstip: HH:MM, 24-uurs. Leeg = alleen het dagdeel is bekend. */
export const TIJD_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Hoe ver vooruit een klant mag boeken (dagen). */
export const MAX_DAYS_AHEAD = 90;

/** Vandaag als yyyy-mm-dd in Amsterdam-tijd — datumgrenzen moeten lokaal kloppen, los van server-UTC. */
export function todayAmsterdam(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** yyyy-mm-dd + n dagen (UTC-rekenkundig; input/output blijven kalenderdatums). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12));
  return dt.toISOString().slice(0, 10);
}

export type CreateAppointmentInput = {
  type: string;
  store: string;
  preferredDate: string; // yyyy-mm-dd
  dagdeel: string;
  name: string;
  email: string;
  phone?: string;
  wensen?: string;
  locale?: string;
  /* De WINKEL plant zelf in (Kevin, 6 aug: "afspraken nu ook zelf een afspraak
     erin kunnen zetten met bevestiging naar de klant"). Twee verschillen met een
     aanvraag via gents.nl:
      - vandaag mag ook. Een klant die aan de balie staat maakt een afspraak voor
        vanmiddag; de "vanaf morgen"-regel is er om online-aanvragen te spreiden,
        niet om de winkel tegen te houden.
      - de afspraak staat meteen VAST (status 'bevestigd'), want er is net met de
        klant over gesproken — geen tweede bevestigingsronde. */
  viaWinkel?: boolean;
  /* Wie 'm inplande, voor het winkeloverzicht. */
  ingepland_door?: string;
  /* Afgesproken tijdstip (HH:MM) — de winkel plant op een concrete tijd. */
  tijd?: string;
};

export type CreateAppointmentResult =
  | { ok: true; id: string; type: AppointmentType; store: string; preferredDate: string; dagdeel: Dagdeel; tijd: string }
  | { ok: false; error: string };

/**
 * Valideert en registreert een afspraakaanvraag. Alle checks server-side
 * (de client valideert ook, maar dit is de autoriteit): echte winkelnaam uit
 * de winkellijst, datum morgen t/m +90 dagen, geldige enums en e-mailvorm.
 * Foutteksten zijn NL-backstop — de client vangt dezelfde gevallen met t()-keys.
 */
export async function createAppointment(input: CreateAppointmentInput): Promise<CreateAppointmentResult> {
  const type = String(input.type || "").trim() as AppointmentType;
  if (!APPOINTMENT_TYPES.includes(type)) return { ok: false, error: "Ongeldig afspraaktype." };

  // Winkel moet letterlijk uit onze winkellijst komen (geen vrije invoer → geen
  // spookwinkels in de kassa-weergave). Match case-insensitief op titel of stad.
  const raw = String(input.store || "").trim().toLowerCase();
  const store = getStores().find((s) => s.title.toLowerCase() === raw || s.city.toLowerCase() === raw);
  if (!store) return { ok: false, error: "Kies een winkel uit de lijst." };

  const preferredDate = String(input.preferredDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) return { ok: false, error: "Ongeldige datum." };
  const today = todayAmsterdam();
  const viaWinkel = input.viaWinkel === true;
  // De winkel mag vandaag inplannen; online-aanvragen blijven vanaf morgen.
  const min = viaWinkel ? today : addDays(today, 1);
  const max = addDays(today, MAX_DAYS_AHEAD);
  // Stringvergelijking werkt voor yyyy-mm-dd; geen Date-parsing (tijdzone-vrij).
  if (preferredDate < min || preferredDate > max) {
    return {
      ok: false,
      error: viaWinkel
        ? "Kies een datum vanaf vandaag, maximaal 90 dagen vooruit."
        : "Kies een datum vanaf morgen, maximaal 90 dagen vooruit.",
    };
  }

  const dagdeel = (String(input.dagdeel || "").trim() || "geen-voorkeur") as Dagdeel;
  if (!DAGDELEN.includes(dagdeel)) return { ok: false, error: "Ongeldig dagdeel." };

  const name = String(input.name || "").trim().slice(0, 120);
  if (!name) return { ok: false, error: "Vul je naam in." };
  const email = String(input.email || "").trim().slice(0, 200);
  if (!/.+@.+\..+/.test(email)) return { ok: false, error: "Vul een geldig e-mailadres in." };

  const phone = String(input.phone || "").trim().slice(0, 40);
  const wensen = String(input.wensen || "").trim().slice(0, 2000);
  const locale = String(input.locale || "nl").trim().slice(0, 5) || "nl";

  /* Tijdstip: alleen de winkel geeft er een op (de klant kiest online een
     dagdeel). Ongeldig formaat is een harde fout — een afspraak "om 25:70"
     stil wegslikken zou als bevestigd zonder tijd de deur uit gaan. */
  const tijd = String(input.tijd || "").trim();
  if (tijd && !TIJD_RE.test(tijd)) return { ok: false, error: "Ongeldig tijdstip (gebruik HH:MM)." };

  const db = getDb();
  const rows = await db
    .insert(appointments)
    .values({
      type, store: store.title, preferredDate, dagdeel, name, email, phone, wensen, locale, tijd,
      /* Door de winkel ingepland = al afgestemd met de klant, dus meteen
         bevestigd. Een online aanvraag blijft 'nieuw' tot de winkel 'm oppakt. */
      ...(viaWinkel ? { status: "bevestigd" } : {}),
    })
    .returning({ id: appointments.id });
  return { ok: true, id: rows[0].id, type, store: store.title, preferredDate, dagdeel, tijd };
}

/**
 * Wat de WINKEL van een afspraak mag zien — bewust zonder e-mailadres (PII-arm):
 * naam + telefoon volstaan om het tijdstip af te stemmen, mails lopen centraal.
 */
export type StoreAppointment = {
  id: string;
  type: string;
  store: string;
  preferredDate: string;
  dagdeel: string;
  /** Afgesproken tijdstip (HH:MM), leeg zolang alleen het dagdeel bekend is. */
  tijd: string;
  name: string;
  phone: string;
  wensen: string;
  status: string;
  createdAt: string;
};

/** Afspraken voor één winkel binnen een datumvenster (default: vandaag t/m +14d). */
export async function listAppointmentsForStore(storeName: string, from?: string, to?: string): Promise<StoreAppointment[] | null> {
  const raw = String(storeName || "").trim().toLowerCase();
  const store = getStores().find((s) => s.title.toLowerCase() === raw || s.city.toLowerCase() === raw);
  if (!store) return null;

  const today = todayAmsterdam();
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(from || "")) ? String(from) : today;
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(to || "")) ? String(to) : addDays(today, 14);

  const db = getDb();
  const rows = await db
    .select({
      id: appointments.id,
      type: appointments.type,
      store: appointments.store,
      preferredDate: appointments.preferredDate,
      dagdeel: appointments.dagdeel,
      tijd: appointments.tijd,
      name: appointments.name,
      phone: appointments.phone,
      wensen: appointments.wensen,
      status: appointments.status,
      createdAt: appointments.createdAt,
    })
    .from(appointments)
    .where(and(eq(appointments.store, store.title), gte(appointments.preferredDate, fromDate), lte(appointments.preferredDate, toDate)))
    .orderBy(asc(appointments.preferredDate), asc(appointments.createdAt));

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** Wat de mail-laag van een zojuist bijgewerkte afspraak nodig heeft. */
export type UpdatedAppointment = {
  id: string;
  type: string;
  store: string;
  preferredDate: string;
  dagdeel: string;
  tijd: string;
  name: string;
  email: string;
  locale: string;
};

/**
 * Status-update vanuit de winkel (kassa/portal), optioneel mét het afgesproken
 * tijdstip (bij bevestigen). Geeft de bijgewerkte afspraak terug — inclusief
 * e-mailadres, zodat de core-route de definitieve bevestiging kan mailen. Dat
 * adres blijft server-side: de kassa krijgt het bewust nooit te zien.
 */
export async function updateAppointmentStatus(
  id: string,
  status: string,
  tijd?: string,
): Promise<{ ok: true; appointment: UpdatedAppointment } | { ok: false; error: string }> {
  if (!APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) return { ok: false, error: "Ongeldige status." };
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return { ok: false, error: "Ongeldig id." };
  const nieuweTijd = String(tijd || "").trim();
  if (nieuweTijd && !TIJD_RE.test(nieuweTijd)) return { ok: false, error: "Ongeldig tijdstip (gebruik HH:MM)." };

  const db = getDb();
  const rows = await db
    .update(appointments)
    // Geen tijd meegegeven = de bestaande laten staan (een no-show-klik mag
    // het eerder afgesproken tijdstip niet wissen).
    .set({ status, updatedAt: sql`now()`, ...(nieuweTijd ? { tijd: nieuweTijd } : {}) })
    .where(eq(appointments.id, id))
    .returning({
      id: appointments.id,
      type: appointments.type,
      store: appointments.store,
      preferredDate: appointments.preferredDate,
      dagdeel: appointments.dagdeel,
      tijd: appointments.tijd,
      name: appointments.name,
      email: appointments.email,
      locale: appointments.locale,
    });
  if (!rows.length) return { ok: false, error: "Afspraak niet gevonden." };
  return { ok: true, appointment: rows[0] };
}

/**
 * Notificatie-adres van een winkel. Bron van waarheid = de instelbare
 * settings-store (storeEmails, sleutel = winkelnaam of stad, lowercase) zodat
 * dit zonder deploy in de tool aan te passen is; env CONTACT_EMAIL_WEDDING /
 * CONTACT_EMAIL_GENERAL is de fallback. Geen adres → null (caller logt een warn
 * en stuurt alleen de klantmail).
 */
export async function storeNotifyEmail(storeTitle: string): Promise<string | null> {
  const s = await getSettings();
  const map = s.storeEmails || {};
  const title = String(storeTitle || "").trim().toLowerCase();
  const city = title.replace(/^gents\s+/i, "");
  const fromSettings = map[title] || map[city];
  if (fromSettings && /.+@.+\..+/.test(fromSettings)) return fromSettings;
  const fallback = process.env.CONTACT_EMAIL_WEDDING || process.env.CONTACT_EMAIL_GENERAL || "";
  return /.+@.+\..+/.test(fallback) ? fallback : null;
}
