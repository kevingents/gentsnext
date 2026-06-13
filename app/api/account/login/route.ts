import { NextResponse } from "next/server";
import { issueMagicToken } from "@/lib/account";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * Vraagt een magic-login-link aan. Stuurt de link per e-mail (Resend) als dat
 * geconfigureerd is; anders (dev) geven we de link in de respons terug zodat
 * de flow testbaar is zonder e-mailinfra.
 */
export async function POST(req: Request) {
  let email = "";
  try {
    const body = await req.json();
    email = String(body?.email || "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }
  if (!/.+@.+\..+/.test(email)) {
    return NextResponse.json({ ok: false, error: "ongeldig e-mailadres" }, { status: 400 });
  }

  const { rawToken } = await issueMagicToken(email);
  const link = `${getSiteUrl()}/api/account/verify?token=${encodeURIComponent(rawToken)}`;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (apiKey && from) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Je login-link voor GENTS",
          html: `<p>Hallo,</p><p>Klik op de onderstaande knop om in te loggen bij GENTS. De link is 30 minuten geldig.</p><p><a href="${link}" style="display:inline-block;background:#0A0A0A;color:#fff;padding:12px 20px;text-decoration:none">Inloggen</a></p><p>Niet aangevraagd? Negeer deze e-mail.</p>`,
        }),
      });
    } catch (e) {
      console.error("[account/login] mailfout:", e);
    }
    return NextResponse.json({ ok: true, sent: true });
  }

  // Geen e-mailinfra. In dev geven we de link terug zodat de flow testbaar is;
  // in productie NOOIT (anders kan iemand op elk e-mailadres inloggen).
  if (process.env.NODE_ENV === "production") {
    console.warn("[account/login] RESEND niet geconfigureerd — login-link niet verstuurd voor", email);
    return NextResponse.json({ ok: true, sent: false });
  }
  return NextResponse.json({ ok: true, sent: false, devLink: link });
}
