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
};

export type CreateAppointmentResult =
  | { ok: true; id: string; type: AppointmentType; store: string; preferredDate: string; dagdeel: Dagdeel }
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
  const min = addDays(today, 1);
  const max = addDays(today, MAX_DAYS_AHEAD);
  // Stringvergelijking werkt voor yyyy-mm-dd; geen Date-parsing (tijdzone-vrij).
  if (preferredDate < min || preferredDate > max) {
    return { ok: false, error: "Kies een datum vanaf morgen, maximaal 90 dagen vooruit." };
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

  const db = getDb();
  const rows = await db
    .insert(appointments)
    .values({ type, store: store.title, preferredDate, dagdeel, name, email, phone, wensen, locale })
    .returning({ id: appointments.id });
  return { ok: true, id: rows[0].id, type, store: store.title, preferredDate, dagdeel };
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

/** Status-update vanuit de winkel (kassa/portal). */
export async function updateAppointmentStatus(id: string, status: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) return { ok: false, error: "Ongeldige status." };
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return { ok: false, error: "Ongeldig id." };
  const db = getDb();
  const rows = await db
    .update(appointments)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(appointments.id, id))
    .returning({ id: appointments.id });
  if (!rows.length) return { ok: false, error: "Afspraak niet gevonden." };
  return { ok: true };
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
