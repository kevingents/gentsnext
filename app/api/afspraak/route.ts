import { NextResponse } from "next/server";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { createAppointment, storeNotifyEmail, type AppointmentType, type Dagdeel } from "@/lib/appointments";
import { sendAppointmentConfirmation, sendAppointmentStoreNotify, emailConfigured } from "@/lib/email";
import { recordEvents } from "@/lib/analytics";
import { getT } from "@/lib/t-server";
import { isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * Boekingsendpoint voor klantafspraken (/afspraak). Valideert server-side
 * (lib/appointments is de autoriteit), schrijft naar Neon, mailt de klant een
 * bevestiging in zijn taal en notificeert de winkel. Mail/analytics zijn
 * fail-soft: de boeking is leidend, een mailfout breekt de UX niet.
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
function fmtDate(iso: string, locale: Locale): string {
  try {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

export async function POST(req: Request) {
  // Backstop rate-limit per IP (DB-insert + 2 mails) — zelfde patroon als contact/stock-notify.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const rl = rateLimit("afspraak:" + fingerprint(ip), 5, 60000);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "Te veel verzoeken — probeer het zo weer." }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  }

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const locale: Locale = isLocale(String(body.locale || "")) ? (String(body.locale) as Locale) : DEFAULT_LOCALE;

  const result = await createAppointment({
    type: String(body.type || ""),
    store: String(body.store || ""),
    preferredDate: String(body.preferredDate || ""),
    dagdeel: String(body.dagdeel || ""),
    name: String(body.name || ""),
    email: String(body.email || ""),
    phone: String(body.phone || ""),
    wensen: String(body.wensen || ""),
    locale,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });

  // Meetpunt (huisregel: alles meetbaar) — geen PII, alleen type + winkel.
  try {
    await recordEvents([{ type: "afspraak_geboekt", path: "/afspraak", props: { type: result.type, store: result.store } }]);
  } catch (e) {
    console.error("[afspraak] analytics-fout:", e);
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const wensen = String(body.wensen || "").trim();

  // Bevestigingsmail naar de klant — teksten via getT(locale), zodat een /en- of
  // /de-boeking de mail in de eigen taal krijgt (nachtcron vertaalt de keys).
  try {
    const t = await getT(locale);
    const typeLabel = t(TYPE_KEY[result.type]);
    const dagdeelLabel = t(DAGDEEL_KEY[result.dagdeel]);
    const rows = [
      { label: t("afspraak.mail.row.type"), value: typeLabel },
      { label: t("afspraak.mail.row.store"), value: result.store },
      { label: t("afspraak.mail.row.date"), value: fmtDate(result.preferredDate, locale) },
      { label: t("afspraak.mail.row.dagdeel"), value: dagdeelLabel },
      ...(wensen ? [{ label: t("afspraak.mail.row.wensen"), value: wensen }] : []),
    ];
    const sent = await sendAppointmentConfirmation({
      to: email,
      subject: t("afspraak.mail.subject", { store: result.store }),
      heading: t("afspraak.mail.heading", { name }),
      body: t("afspraak.mail.body", { type: typeLabel, store: result.store }),
      rows,
      outro: t("afspraak.mail.outro"),
    });
    if (!sent && !emailConfigured()) console.log(`[afspraak] (stub mail) bevestiging naar ${email} voor ${result.store}`);
  } catch (e) {
    console.error("[afspraak] klantmail-fout:", e);
  }

  // Notificatie naar de winkel (intern, NL). Geen adres bekend → alleen klantmail + warn.
  try {
    const to = await storeNotifyEmail(result.store);
    if (to) {
      const tNl = await getT(DEFAULT_LOCALE);
      await sendAppointmentStoreNotify({
        to,
        store: result.store,
        typeLabel: tNl(TYPE_KEY[result.type]),
        preferredDate: fmtDate(result.preferredDate, DEFAULT_LOCALE),
        dagdeel: tNl(DAGDEEL_KEY[result.dagdeel]),
        name,
        phone: String(body.phone || "").trim(),
        wensen,
        customerEmail: email,
      });
    } else {
      console.warn(`[afspraak] geen notificatie-adres voor ${result.store} (settings.storeEmails / CONTACT_EMAIL_WEDDING) — alleen klantmail verstuurd.`);
    }
  } catch (e) {
    console.error("[afspraak] winkelnotificatie-fout:", e);
  }

  return NextResponse.json({ ok: true, id: result.id });
}
