import { NextResponse } from "next/server";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { createWelcomeVoucher } from "@/lib/vouchers";
import { getSettings } from "@/lib/settings";
import { brandedEmailHtml, emailConfigured } from "@/lib/email";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

const PERCENT_OFF = 10;
const VALID_DAYS = 30;

/**
 * Mailt de welkomstcode na. De code stond alleen in de popup, en die komt door
 * de localStorage-vlag nooit meer terug — sloot de bezoeker 'm, dan was de code
 * weg. Best-effort en env-gated (zonder Resend-config gebeurt er niets); het
 * resultaat gaat terug naar de popup, zodat die alleen "we hebben 'm gemaild"
 * zegt als dat ook echt gebeurd is.
 */
async function mailWelcomeCode(email: string, code: string): Promise<boolean> {
  if (!emailConfigured()) return false;
  const site = getSiteUrl();
  const html = brandedEmailHtml({
    heading: "Je welkomstkorting staat klaar",
    bodyHtml: `
      <p style="margin:0 0 14px">Bedankt voor je inschrijving. Met deze code krijg je <strong>${PERCENT_OFF}% korting</strong> op je volgende bestelling:</p>
      <div style="display:inline-block;background:#F6F5F2;border:1px solid #E6E4DF;color:#111111;font:700 20px 'Courier New',monospace;letter-spacing:2px;padding:12px 20px">${code}</div>
      <p style="margin:14px 0 0">Vul 'm bij het afrekenen in onder “Kortingscode”.</p>`,
    cta: { label: "Begin met shoppen", href: site },
    footnote: `Eenmalig te gebruiken en ${VALID_DAYS} dagen geldig.`,
  });
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: [email],
        subject: `Je GENTS-welkomstkorting: ${PERCENT_OFF}% met code ${code}`,
        html,
      }),
    });
    if (!res.ok) {
      console.error("[welcome-discount] Resend-fout:", res.status, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Welkomstkorting: maakt een unieke kortingscode voor het e-mailadres, schrijft
 * in op de nieuwsbrief en geeft de code terug voor de popup.
 */
export async function POST(req: Request) {
  // Backstop rate-limit per IP (mint vouchers).
  const _ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const _rl = rateLimit("welcome:" + fingerprint(_ip), 5, 60000);
  if (!_rl.ok) return NextResponse.json({ ok: false, error: "Te veel verzoeken — probeer het zo weer." }, { status: 429, headers: { "retry-after": String(_rl.retryAfterSec) } });
  let email = "";
  try {
    email = String((await req.json())?.email || "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }
  if (!/.+@.+\..+/.test(email)) return NextResponse.json({ ok: false, error: "ongeldig e-mailadres" }, { status: 400 });

  const code = await createWelcomeVoucher(email, PERCENT_OFF, VALID_DAYS);

  // Inschrijven op de nieuwsbrief (best-effort, hergebruikt /api/newsletter-logica).
  const audience = process.env.RESEND_AUDIENCE_ID;
  const apiKey = process.env.RESEND_API_KEY;
  if (audience && apiKey) {
    try {
      await fetch(`https://api.resend.com/audiences/${audience}/contacts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email, unsubscribed: false }),
      });
    } catch {
      /* niet kritisch */
    }
  }

  const mailed = await mailWelcomeCode(email, code);

  await getSettings(); // warmt cache; geen verdere actie
  return NextResponse.json({ ok: true, code, percentOff: PERCENT_OFF, mailed });
}
