import { sendAppointmentConfirmation, sendAppointmentStoreNotify, emailConfigured } from "@/lib/email";
import { getT } from "@/lib/t-server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";
import { storeNotifyEmail, type AppointmentType, type Dagdeel, type UpdatedAppointment } from "@/lib/appointments";

/**
 * lib/afspraak-mail.ts — de bevestigingsmail bij een afspraak, één keer.
 *
 * Stond eerst alleen in app/api/afspraak/route.ts (de publieke boeking). Nu de
 * WINKEL ook zelf kan inplannen (Kevin, 6 aug: "afspraken nu ook zelf een
 * afspraak erin kunnen zetten met bevestiging naar de klant") moet die klant
 * dezelfde mail krijgen — en niet een tweede, net iets andere variant die bij
 * elke tekstwijziging uit de pas gaat lopen.
 */

const TYPE_KEY: Record<AppointmentType, string> = {
  trouwconsult: "afspraak.type.trouwconsult",
  pasafspraak: "afspraak.type.pasafspraak",
  "personal-shopping": "afspraak.type.personalShopping",
};

const DAGDEEL_KEY: Record<Dagdeel, string> = {
  ochtend: "afspraak.dagdeel.ochtend",
  middag: "afspraak.dagdeel.middag",
  avond: "afspraak.dagdeel.avond",
  "geen-voorkeur": "afspraak.dagdeel.geenVoorkeur",
};

/** yyyy-mm-dd → leesbare datum in de taal van de klant (kalenderdag, tijdzone-vrij). */
export function fmtAfspraakDatum(iso: string, locale: Locale): string {
  try {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, {
      timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  } catch {
    return iso;
  }
}

export type AfspraakMailInput = {
  type: AppointmentType;
  store: string;
  preferredDate: string;
  dagdeel: Dagdeel;
  name: string;
  email: string;
  phone?: string;
  wensen?: string;
  locale?: Locale;
  /* Door de winkel ingepland: dan is de afspraak al afgestemd met de klant.
     De winkel hoeft zichzelf geen notificatie te sturen. */
  viaWinkel?: boolean;
};

/**
 * Bevestiging naar de klant (+ notificatie naar de winkel bij een online
 * aanvraag). Fail-soft: de afspraak staat al in de database, een mailfout mag
 * dat niet ongedaan maken — we melden 'm alleen terug zodat de winkel weet dat
 * ze de klant even moeten bellen.
 */
export async function stuurAfspraakMails(a: AfspraakMailInput): Promise<{ klantMail: boolean }> {
  const locale = (a.locale || DEFAULT_LOCALE) as Locale;
  const name = String(a.name || "").trim().slice(0, 120);
  const email = String(a.email || "").trim().slice(0, 200);
  const wensen = String(a.wensen || "").trim().slice(0, 2000);
  const phone = String(a.phone || "").trim().slice(0, 40);

  let klantMail = false;
  try {
    const t = await getT(locale);
    const typeLabel = t(TYPE_KEY[a.type]);
    const dagdeelLabel = t(DAGDEEL_KEY[a.dagdeel]);
    const rows = [
      { label: t("afspraak.mail.row.type"), value: typeLabel },
      { label: t("afspraak.mail.row.store"), value: a.store },
      { label: t("afspraak.mail.row.date"), value: fmtAfspraakDatum(a.preferredDate, locale) },
      { label: t("afspraak.mail.row.dagdeel"), value: dagdeelLabel },
      ...(wensen ? [{ label: t("afspraak.mail.row.wensen"), value: wensen }] : []),
    ];
    klantMail = await sendAppointmentConfirmation({
      to: email,
      subject: t("afspraak.mail.subject", { store: a.store }),
      heading: t("afspraak.mail.heading", { name }),
      body: t("afspraak.mail.body", { type: typeLabel, store: a.store }),
      rows,
      outro: t("afspraak.mail.outro"),
    });
    if (!klantMail && !emailConfigured()) {
      console.log(`[afspraak] (stub mail) bevestiging naar ${email} voor ${a.store}`);
    }
  } catch (e) {
    console.error("[afspraak] klantmail-fout:", e);
  }

  /* Winkelnotificatie alleen bij een ONLINE aanvraag: als de winkel 'm zelf
     inplande weten ze het al, en een mail aan jezelf is ruis. */
  if (!a.viaWinkel) {
    try {
      const to = await storeNotifyEmail(a.store);
      if (to) {
        const tNl = await getT(DEFAULT_LOCALE);
        await sendAppointmentStoreNotify({
          to,
          store: a.store,
          typeLabel: tNl(TYPE_KEY[a.type]),
          preferredDate: fmtAfspraakDatum(a.preferredDate, DEFAULT_LOCALE),
          dagdeel: tNl(DAGDEEL_KEY[a.dagdeel]),
          name, phone, wensen, customerEmail: email,
        });
      } else {
        console.warn(`[afspraak] geen notificatie-adres voor ${a.store}`);
      }
    } catch (e) {
      console.error("[afspraak] winkelmail-fout:", e);
    }
  }

  return { klantMail };
}

/**
 * De DEFINITIEVE bevestiging: de winkel heeft het tijdstip vastgelegd, de
 * afspraak staat. Dit is een andere mail dan de ontvangstbevestiging hierboven
 * ("we nemen contact op") — die belooft juist dat deze mail nog komt. Zonder
 * tijdstip (bevestigd zonder tijd) valt de tekst terug op datum + dagdeel.
 * Fail-soft, zelfde afspraak als hierboven: de status stáát al in de database.
 */
export async function stuurAfspraakBevestigdMail(a: UpdatedAppointment): Promise<{ klantMail: boolean }> {
  const locale: Locale = isLocale(a.locale) ? a.locale : DEFAULT_LOCALE;
  const email = String(a.email || "").trim();
  if (!/.+@.+\..+/.test(email)) return { klantMail: false };

  try {
    const t = await getT(locale);
    const typeLabel = t(TYPE_KEY[a.type as AppointmentType] ?? TYPE_KEY.pasafspraak);
    const datum = fmtAfspraakDatum(a.preferredDate, locale);
    const rows = [
      { label: t("afspraak.mail.row.type"), value: typeLabel },
      { label: t("afspraak.mail.row.store"), value: a.store },
      { label: t("afspraak.mail.bevestigd.row.date"), value: datum },
      ...(a.tijd
        ? [{ label: t("afspraak.mail.row.tijd"), value: a.tijd }]
        : [{ label: t("afspraak.mail.row.dagdeel"), value: t(DAGDEEL_KEY[a.dagdeel as Dagdeel] ?? DAGDEEL_KEY["geen-voorkeur"]) }]),
    ];
    const klantMail = await sendAppointmentConfirmation({
      to: email,
      subject: t("afspraak.mail.bevestigd.subject", { store: a.store }),
      heading: t("afspraak.mail.bevestigd.heading", { name: a.name }),
      body: a.tijd
        ? t("afspraak.mail.bevestigd.body", { type: typeLabel, store: a.store, date: datum, time: a.tijd })
        : t("afspraak.mail.bevestigd.bodyZonderTijd", { type: typeLabel, store: a.store, date: datum }),
      rows,
      outro: t("afspraak.mail.outro"),
    });
    if (!klantMail && !emailConfigured()) {
      console.log(`[afspraak] (stub mail) definitieve bevestiging naar ${email} voor ${a.store}`);
    }
    return { klantMail };
  } catch (e) {
    console.error("[afspraak] bevestigingsmail-fout:", e);
    return { klantMail: false };
  }
}
