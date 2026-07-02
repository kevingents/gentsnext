import { NextResponse } from "next/server";
import { rateLimit, fingerprint } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ROUTING: Record<string, string | undefined> = {
  zakelijk: process.env.CONTACT_EMAIL_B2B,
  students: process.env.CONTACT_EMAIL_STUDENTS,
  trouw: process.env.CONTACT_EMAIL_WEDDING,
  uitvaart: process.env.CONTACT_EMAIL_FUNERAL,
  algemeen: process.env.CONTACT_EMAIL_GENERAL,
};

const FALLBACK = process.env.CONTACT_EMAIL_GENERAL || process.env.CONTACT_EMAIL_B2B;

/**
 * Contact-request endpoint. Stuurt de aanvraag door via Resend naar het juiste
 * team-mailadres (per kanaal in CONTACT_EMAIL_<X>). Env-gated: als nergens een
 * RESEND_API_KEY/CONTACT_EMAIL_* staat, accepteren we netjes (logging-only)
 * zodat de UX-flow tijdens de bouw werkt.
 */
export async function POST(req: Request) {
  // Backstop rate-limit per IP (DB-insert + mail).
  const _ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const _rl = rateLimit("contact:" + fingerprint(_ip), 8, 60000);
  if (!_rl.ok) return NextResponse.json({ ok: false, error: "Te veel verzoeken — probeer het zo weer." }, { status: 429, headers: { "retry-after": String(_rl.retryAfterSec) } });
  let payload: Record<string, string>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }

  const { channel, name, email, message } = payload;
  if (!name || !email || !message) {
    return NextResponse.json({ ok: false, error: "naam, e-mail en bericht zijn vereist" }, { status: 400 });
  }
  if (!/.+@.+\..+/.test(email)) {
    return NextResponse.json({ ok: false, error: "ongeldig e-mailadres" }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const to = (channel && ROUTING[channel]) || FALLBACK;
  const subject = `GENTS contactaanvraag — ${channel || "algemeen"} — ${name}`;
  const lines = Object.entries(payload)
    .filter(([k]) => k !== "channel" && k !== "message")
    .map(([k, v]) => `${k}: ${v}`)
    .concat(["", "Bericht:", String(message)])
    .join("\n");

  if (apiKey && from && to) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [to],
          reply_to: email,
          subject,
          text: lines,
        }),
      });
      if (!r.ok) {
        console.error("[contact] Resend-fout:", r.status, (await r.text()).slice(0, 200));
        return NextResponse.json({ ok: false, error: "verzending mislukte" }, { status: 502 });
      }
    } catch (e) {
      console.error("[contact] fetch-fout:", e);
      return NextResponse.json({ ok: false, error: "verzending mislukte" }, { status: 502 });
    }
  } else {
    console.log("[contact] (stub) inkomende aanvraag", { subject, payload });
  }
  return NextResponse.json({ ok: true });
}
