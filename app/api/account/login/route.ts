import { NextResponse } from "next/server";
import { issueMagicToken, magicLinkThrottled } from "@/lib/account";
import { getSiteUrl } from "@/lib/site-url";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { brandedEmailHtml } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * Vraagt een magic-login-link aan. Stuurt de link per e-mail (Resend) als dat
 * geconfigureerd is; anders (dev) geven we de link in de respons terug zodat
 * de flow testbaar is zonder e-mailinfra.
 */
export async function POST(req: Request) {
  // Per-IP backstop: de per-e-mail-throttle is te omzeilen door adres-rotatie
  // (e-mailbombing naar derden + ongelimiteerde nep-klantrijen). Deze IP-limiet
  // dekt dat af, náást de per-adres-throttle hieronder.
  const _ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const _rl = rateLimit("login:" + fingerprint(_ip), 12, 60000);
  if (!_rl.ok) {
    return NextResponse.json({ ok: false, error: "Te veel loginpogingen — probeer het zo weer." }, { status: 429, headers: { "retry-after": String(_rl.retryAfterSec) } });
  }
  let email = "";
  let next = "";
  try {
    const body = await req.json();
    email = String(body?.email || "").trim().toLowerCase();
    next = String(body?.next || "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }
  if (!/.+@.+\..+/.test(email)) {
    return NextResponse.json({ ok: false, error: "ongeldig e-mailadres" }, { status: 400 });
  }

  // Anti-bombing: te veel aanvragen voor dit adres? Doe alsof het gelukt is
  // (niet onthullen of het bestaat) maar stuur geen nieuwe mail.
  if (await magicLinkThrottled(email)) {
    return NextResponse.json({ ok: true, sent: true });
  }

  const { rawToken } = await issueMagicToken(email);
  // next mag alleen een interne (relatieve) pad zijn — geen open redirect.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "";
  const link = `${getSiteUrl()}/api/account/verify?token=${encodeURIComponent(rawToken)}${safeNext ? `&next=${encodeURIComponent(safeNext)}` : ""}`;

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
          subject: "Je inloglink voor GENTS",
          html: brandedEmailHtml({
            heading: "Inloggen bij GENTS",
            bodyHtml: "<p style=\"margin:0 0 10px\">Klik op de knop hieronder om in te loggen op je account. De link is <strong>30 minuten</strong> geldig en werkt één keer.</p><p style=\"margin:0\">Zo heb je je bestellingen, bewaarde maten, spaarpunten en favorieten meteen bij de hand.</p>",
            cta: { label: "Inloggen", href: link },
            footnote: "Heb je dit niet aangevraagd? Dan kun je deze e-mail veilig negeren — er gebeurt niets.",
          }),
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
