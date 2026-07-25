import { NextResponse } from "next/server";
import { issueMagicToken, magicLinkThrottled } from "@/lib/account";
import { getSiteUrl } from "@/lib/site-url";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { brandedEmailHtml, mailT } from "@/lib/email";
import { getLocale } from "@/lib/locale-server";
import { localizedPath } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * Vraagt een magic-login-link aan. Stuurt de link per e-mail (Resend) als dat
 * geconfigureerd is; anders (dev) geven we de link in de respons terug zodat
 * de flow testbaar is zonder e-mailinfra.
 *
 * De mail volgt de taal van de bezoeker: de middleware slaat /api over, dus
 * getLocale() leest hier de locale-cookie die diezelfde middleware op elke
 * /en-, /de-… pagina zet.
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
  const locale = await getLocale();
  // next mag alleen een interne (relatieve) pad zijn — geen open redirect.
  // Zonder next landt de verify-route op /account; voor een anderstalige
  // bezoeker sturen we 'm naar de eigen taalversie (/en/account), zodat de mail
  // én de bestemming dezelfde taal spreken.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : localizedPath("/account", locale);
  const link = `${getSiteUrl()}/api/account/verify?token=${encodeURIComponent(rawToken)}${safeNext ? `&next=${encodeURIComponent(safeNext)}` : ""}`;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (apiKey && from) {
    try {
      const t = await mailT(locale);
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [email],
          subject: t("mail.login.subject"),
          html: brandedEmailHtml({
            heading: t("mail.login.heading"),
            bodyHtml: `<p style="margin:0 0 10px">${t("mail.login.body1")}</p><p style="margin:0">${t("mail.login.body2")}</p>`,
            cta: { label: t("common.login"), href: link },
            footnote: t("mail.login.footnote"),
            locale,
            t,
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
