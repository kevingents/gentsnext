import { NextResponse } from "next/server";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { createAppointment } from "@/lib/appointments";
import { stuurAfspraakMails } from "@/lib/afspraak-mail";
import { recordEvents } from "@/lib/analytics";
import { isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * Boekingsendpoint voor klantafspraken (/afspraak). Valideert server-side
 * (lib/appointments is de autoriteit), schrijft naar Neon, mailt de klant een
 * bevestiging in zijn taal en notificeert de winkel. Mail/analytics zijn
 * fail-soft: de boeking is leidend, een mailfout breekt de UX niet.
 */

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

  // Zelfde lengte-caps als createAppointment op de DB-velden: de mails mogen geen
  // ongelimiteerde body-invoer meekrijgen (een directe API-call met megabytes
  // "wensen" zou anders integraal in klant- én winkelmail belanden).
  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().slice(0, 200);
  const wensen = String(body.wensen || "").trim().slice(0, 2000);

  /* Bevestiging naar de klant + notificatie naar de winkel. Eén gedeelde plek
     (lib/afspraak-mail) — de winkel kan sinds 6 aug óók zelf een afspraak
     inplannen, en die klant hoort exact dezelfde mail te krijgen. */
  await stuurAfspraakMails({
    type: result.type,
    store: result.store,
    preferredDate: result.preferredDate,
    dagdeel: result.dagdeel,
    name,
    email,
    phone: String(body.phone || "").trim().slice(0, 40),
    wensen,
    locale,
  });

  return NextResponse.json({ ok: true, id: result.id });
}
