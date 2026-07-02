import { NextResponse } from "next/server";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { createWelcomeVoucher } from "@/lib/vouchers";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

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

  const code = await createWelcomeVoucher(email, 10, 30);

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

  await getSettings(); // warmt cache; geen verdere actie
  return NextResponse.json({ ok: true, code, percentOff: 10 });
}
