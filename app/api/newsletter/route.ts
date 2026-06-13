import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Newsletter signup — env-gated. Werkt al met Resend Audiences zodra
 * RESEND_API_KEY + RESEND_AUDIENCE_ID gezet zijn. Anders accepteren we de
 * inschrijving netjes (logging) zodat de UX-flow getest kan worden tijdens
 * de bouw.
 */
export async function POST(req: Request) {
  let email = "";
  try {
    const body = await req.json();
    email = String(body?.email || "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }
  if (!/.+@.+\..+/.test(email)) {
    return NextResponse.json({ ok: false, error: "ongeldig e-mailadres" }, { status: 400 });
  }

  const audience = process.env.RESEND_AUDIENCE_ID;
  const apiKey = process.env.RESEND_API_KEY;
  if (audience && apiKey) {
    try {
      const r = await fetch(`https://api.resend.com/audiences/${audience}/contacts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email, unsubscribed: false }),
      });
      if (!r.ok && r.status !== 409) {
        const t = await r.text();
        console.error("[newsletter] Resend-fout:", r.status, t.slice(0, 200));
        return NextResponse.json({ ok: false }, { status: 502 });
      }
    } catch (e) {
      console.error("[newsletter] fetch-fout:", e);
      return NextResponse.json({ ok: false }, { status: 502 });
    }
  } else {
    console.log("[newsletter] (stub) inschrijving:", email);
  }
  return NextResponse.json({ ok: true });
}
