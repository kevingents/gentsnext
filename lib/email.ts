import { getSiteUrl } from "@/lib/site-url";
import { formatEuro as euro } from "@/lib/format";

/**
 * Transactionele mail via Resend (env-gated op RESEND_API_KEY). Bewust zonder
 * extra SDK: directe call naar de Resend API, net als de Mollie-client.
 * Afzender via RESEND_FROM (bv. "GENTS <bestellingen@gents.nl>").
 */

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

type OrderLine = {
  title: string;
  size: string;
  color: string;
  quantity: number;
  unitPriceCents: number;
  roleLabel: string | null;
};
type OrderInfo = {
  orderNumber: string;
  firstName: string;
  email: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  discountCents?: number;
  giftcardCents?: number;
};

type CrossSellItem = { handle: string; title: string; imageUrl: string; minPriceCents: number; hasPriceRange?: boolean };

function orderHtml(order: OrderInfo, lines: OrderLine[], recs: CrossSellItem[] = []): string {
  const site = getSiteUrl();
  const points = Math.max(0, Math.floor(order.totalCents / 100)); // 1 punt per euro
  const rows = lines
    .map(
      (l) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #E6E4DF;font:14px Arial,sans-serif;color:#0A0A0A">
          ${l.roleLabel ? `<span style="color:#8B8B8B">${l.roleLabel}: </span>` : ""}${l.title}
          <div style="color:#8B8B8B;font-size:12px">${[l.color, l.size && `maat ${l.size}`, `${l.quantity}×`].filter(Boolean).join(" · ")}</div>
        </td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid #E6E4DF;font:14px Arial,sans-serif;color:#0A0A0A">${euro(l.unitPriceCents * l.quantity)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#EDEBE7;padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #E6E4DF">
        ${brandHeaderRow()}
        <tr><td style="padding:24px 28px 8px">
          <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">Bedankt voor je bestelling, ${order.firstName || ""}</h1>
          <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">
            We hebben je betaling ontvangen en gaan voor je aan de slag. Hieronder vind je je bestelling.
          </p>
          <p style="font:13px Arial,sans-serif;color:#8B8B8B;margin:4px 0">Bestelnummer <strong style="color:#0A0A0A">${order.orderNumber}</strong></p>
        </td></tr>
        <tr><td style="padding:8px 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
            <tr><td style="padding:10px 0 0;font:14px Arial,sans-serif;color:#8B8B8B">Subtotaal</td><td align="right" style="padding:10px 0 0;font:14px Arial,sans-serif;color:#0A0A0A">${euro(order.subtotalCents)}</td></tr>
            ${order.discountCents ? `<tr><td style="padding:4px 0;font:14px Arial,sans-serif;color:#8B8B8B">Korting</td><td align="right" style="padding:4px 0;font:14px Arial,sans-serif;color:#0A0A0A">− ${euro(order.discountCents)}</td></tr>` : ""}
            <tr><td style="padding:4px 0;font:14px Arial,sans-serif;color:#8B8B8B">Verzending</td><td align="right" style="padding:4px 0;font:14px Arial,sans-serif;color:#0A0A0A">${order.shippingCents === 0 ? "Gratis" : euro(order.shippingCents)}</td></tr>
            ${order.giftcardCents ? `<tr><td style="padding:4px 0;font:14px Arial,sans-serif;color:#8B8B8B">Cadeaubon</td><td align="right" style="padding:4px 0;font:14px Arial,sans-serif;color:#0A0A0A">− ${euro(order.giftcardCents)}</td></tr>` : ""}
            <tr><td style="padding:8px 0;border-top:1px solid #E6E4DF;font:600 15px Arial,sans-serif;color:#0A0A0A">${order.giftcardCents ? "Nog te betalen" : "Totaal"}</td><td align="right" style="padding:8px 0;border-top:1px solid #E6E4DF;font:600 15px Arial,sans-serif;color:#0A0A0A">${euro(order.totalCents)}</td></tr>
          </table>
        </td></tr>
        ${
          recs.length
            ? `<tr><td style="padding:20px 28px 4px">
          <p style="font:600 14px Arial,sans-serif;color:#0A0A0A;margin:0 0 12px">Maak je look compleet</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${recs
              .map(
                (r) => `<td width="33%" valign="top" style="padding:0 5px">
              <a href="${site}/products/${r.handle}" style="text-decoration:none;color:#0A0A0A">
                ${r.imageUrl ? `<img src="${r.imageUrl}" width="100%" alt="" style="display:block;border:1px solid #E6E4DF;background:#F6F5F2"/>` : ""}
                <div style="font:12px Arial,sans-serif;color:#0A0A0A;margin-top:6px;line-height:1.3">${r.title}</div>
                <div style="font:12px Arial,sans-serif;color:#8B8B8B">${r.hasPriceRange ? "vanaf " : ""}${euro(r.minPriceCents)}</div>
              </a>
            </td>`
              )
              .join("")}
          </tr></table>
        </td></tr>`
            : ""
        }
        ${
          points > 0
            ? `<tr><td style="padding:8px 28px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#F6F5F2;border:1px solid #E6E4DF;padding:16px">
            <div style="font:600 14px Arial,sans-serif;color:#0A0A0A">Je spaart ${points} punten met deze bestelling</div>
            <div style="font:13px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin-top:4px">Bekijk en verzilver ze in je <a href="${site}/account" style="color:#0A0A0A">GENTS-account</a>. Nog geen account? Maak er een aan met dit e-mailadres en je punten staan klaar.</div>
          </td></tr></table>
        </td></tr>`
            : ""
        }
        <tr><td style="padding:16px 28px 28px">
          <p style="font:13px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0">
            <strong>Bezorgadres</strong><br>${order.street} ${order.houseNumber}<br>${order.postalCode} ${order.city}
          </p>
          <p style="font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.6;margin-top:16px">
            Niet helemaal tevreden? Je hebt 14 dagen bedenktijd en retourneert gratis.
            Vragen? Antwoord op deze mail of bezoek <a href="${site}" style="color:#0A0A0A">gents.nl</a>.
          </p>
        </td></tr>
      </table>
      <div style="font:11px Arial,sans-serif;color:#8B8B8B;margin-top:16px">GENTS B.V. · Lemelerbergweg 15, 1101 AJ Amsterdam · Alle prijzen incl. btw</div>
    </td></tr></table>
  </body></html>`;
}

/* ── Cadeaubon ── */

type GiftcardEmail = {
  code: string;
  initialCents: number;
  recipientName: string;
  recipientEmail: string;
  senderName: string;
  message: string;
  expiresAt: Date | null;
};

function giftcardHtml(g: GiftcardEmail): string {
  const site = getSiteUrl();
  const greeting = g.recipientName ? `Hoi ${g.recipientName},` : "Hoi,";
  const fromLine = g.senderName
    ? `<strong style="color:#0A0A0A">${g.senderName}</strong> heeft je een GENTS-cadeaubon gestuurd.`
    : `Je hebt een GENTS-cadeaubon ontvangen.`;
  const expiry = g.expiresAt
    ? new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" }).format(g.expiresAt)
    : null;
  const personal = g.message
    ? `<tr><td style="padding:8px 28px 0">
         <div style="border-left:3px solid #0A0A0A;padding:6px 0 6px 14px;font:italic 14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${g.message}</div>
       </td></tr>`
    : "";

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#EDEBE7;padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #E6E4DF">
        ${brandHeaderRow()}
        <tr><td style="padding:24px 28px 8px">
          <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">${greeting}</h1>
          <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:8px 0 0">${fromLine}</p>
        </td></tr>
        ${personal}
        <tr><td style="padding:20px 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #0A0A0A">
            <tr><td align="center" style="padding:22px 16px;background:#0A0A0A">
              <div style="font:11px Arial,sans-serif;letter-spacing:3px;color:#C9A14A">CADEAUBON</div>
              <div style="font:600 34px Arial,sans-serif;color:#fff;margin:6px 0">${euro(g.initialCents)}</div>
              <div style="font:12px Arial,sans-serif;color:#B9B9B9;margin-bottom:10px">Cadeaubon-code</div>
              <div style="display:inline-block;background:#fff;color:#0A0A0A;font:700 20px 'Courier New',monospace;letter-spacing:2px;padding:10px 18px">${g.code}</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 28px 8px">
          <p style="font:13px Arial,sans-serif;color:#2C2C2C;line-height:1.7;margin:0">
            <strong>Zo verzilver je 'm:</strong> shop op <a href="${site}" style="color:#0A0A0A">gents.nl</a>, vul bij het afrekenen de code in onder “Cadeaubon”. Het bedrag wordt van je bestelling afgetrokken — je kunt 'm in meerdere keren gebruiken tot het saldo op is.
          </p>
          ${expiry ? `<p style="font:12px Arial,sans-serif;color:#8B8B8B;margin:10px 0 0">Geldig tot ${expiry}.</p>` : ""}
        </td></tr>
        <tr><td style="padding:18px 28px 28px">
          <a href="${site}" style="display:inline-block;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 22px;text-decoration:none">Begin met shoppen</a>
        </td></tr>
      </table>
      <div style="font:11px Arial,sans-serif;color:#8B8B8B;margin-top:16px">GENTS B.V. · Lemelerbergweg 15, 1101 AJ Amsterdam · Alle prijzen incl. btw</div>
    </td></tr></table>
  </body></html>`;
}

export async function sendGiftcardEmail(g: GiftcardEmail): Promise<boolean> {
  if (!emailConfigured() || !g.recipientEmail) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [g.recipientEmail],
      subject: g.senderName ? `${g.senderName} stuurt je een GENTS-cadeaubon` : "Je GENTS-cadeaubon",
      html: giftcardHtml(g),
    }),
  });
  if (!res.ok) {
    console.error("[email] giftcard Resend-fout:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}

/* ── Gedeelde wrapper + generieke verzender (voor lifecycle-mails) ── */

/** Zwarte merk-header met het officiële witte logo (zelfde asset als de
 *  site-footer; de slogan zit al ín het logo — niets aan toevoegen). */
function brandHeaderRow(): string {
  const site = getSiteUrl();
  return `<tr><td style="padding:0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111111">
      <tr><td align="center" style="padding:26px 28px">
        <img src="${site}/brand/brand-logo-wit.png" width="150" alt="GENTS — Suits You"
          style="display:block;width:150px;max-width:60%;height:auto;margin:0 auto" />
      </td></tr>
    </table>
  </td></tr>`;
}

/** Gebrande footer binnen de kaart: snelkoppelingen + tagline. */
function brandFooterRow(): string {
  const site = getSiteUrl();
  const link = (href: string, label: string) =>
    `<a href="${site}${href}" style="color:#111111;text-decoration:none;font:12px Arial,sans-serif">${label}</a>`;
  return `<tr><td style="padding:8px 28px 26px">
    <div style="border-top:1px solid #E6E4DF;padding-top:18px">
      <div style="font:12px Arial,sans-serif;color:#111111">
        ${link("/account", "Mijn account")} &nbsp;·&nbsp; ${link("/winkels", "Winkels")} &nbsp;·&nbsp; ${link("/retourneren", "Retourneren")} &nbsp;·&nbsp; ${link("/klantenservice", "Klantenservice")}
      </div>
      <div style="font:11px Arial,sans-serif;color:#B2AEA8;margin-top:12px">Persoonlijk advies in 19 winkels · gratis retour binnen 14 dagen · alle prijzen incl. btw</div>
    </div>
  </td></tr>`;
}

function shell(inner: string): string {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#EDEBE7;padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #E6E4DF">
        ${brandHeaderRow()}
        ${inner}
        ${brandFooterRow()}
      </table>
      <div style="font:11px Arial,sans-serif;color:#9a958d;margin-top:14px">GENTS B.V. · Lemelerbergweg 15, 1101 AJ Amsterdam</div>
    </td></tr></table>
  </body></html>`;
}

/**
 * Gebrande e-mail (voor losse mails buiten de lifecycle-set, bv. de inlog-link).
 * `bodyHtml` is vrije HTML in de contentzone; optionele knop + voetnoot.
 */
export function brandedEmailHtml(opts: { heading: string; bodyHtml: string; cta?: { label: string; href: string }; footnote?: string }): string {
  const inner = `
    <tr><td style="padding:26px 28px 6px">
      <h1 style="font:400 22px Arial,sans-serif;color:#111111;margin:0">${opts.heading}</h1>
    </td></tr>
    <tr><td style="padding:6px 28px;font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.65">${opts.bodyHtml}</td></tr>
    ${opts.cta ? `<tr><td style="padding:14px 28px 6px">
      <a href="${opts.cta.href}" style="display:inline-block;background:#111111;color:#ffffff;font:14px Arial,sans-serif;padding:13px 26px;text-decoration:none;letter-spacing:.5px">${opts.cta.label}</a>
    </td></tr>` : ""}
    ${opts.footnote ? `<tr><td style="padding:10px 28px 6px;font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.5">${opts.footnote}</td></tr>` : ""}
  `;
  return shell(inner);
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!emailConfigured() || !to) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.RESEND_FROM, to: [to], subject, html }),
  });
  if (!res.ok) {
    console.error("[email] Resend-fout:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}

/** Welkomstmail bij de eerste account-bevestiging (one-shot, zie account.ts). */
export async function sendWelcomeEmail(email: string, firstName: string): Promise<boolean> {
  const site = getSiteUrl();
  const hi = firstName ? `Welkom, ${firstName}` : "Welkom bij GENTS";
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">${hi}</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">
        Goed dat je er bent. Je account staat klaar — je bestellingen, bewaarde maten en favorieten vind je voortaan op één plek.
      </p>
    </td></tr>
    <tr><td style="padding:4px 28px">
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.7;margin:0"><strong>Handig om te weten</strong></p>
      <ul style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.7;margin:6px 0 0;padding-left:18px">
        <li>Bewaar je maten en we vullen ze automatisch in — <a href="${site}/maatadvies" style="color:#0A0A0A">doe het maatadvies</a>.</li>
        <li>Gratis retour binnen 14 dagen, ook in onze winkels.</li>
        <li>Persoonlijk advies in 19 winkels door heel Nederland.</li>
      </ul>
    </td></tr>
    <tr><td style="padding:20px 28px 28px">
      <a href="${site}" style="display:inline-block;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 22px;text-decoration:none">Begin met shoppen</a>
    </td></tr>`;
  return sendEmail(email, "Welkom bij GENTS", shell(inner));
}

/** "Rond je profiel af voor +50 punten" — incentive-mail met afrond-link. */
export async function sendProfileCompletionIncentiveEmail(email: string, firstName: string, token: string): Promise<boolean> {
  const site = getSiteUrl();
  const url = `${site}/profiel-afronden?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  const hi = firstName ? `Hoi ${firstName},` : "Hoi,";
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">Rond je profiel af — 50 punten cadeau</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${hi} maak je GENTS-profiel even compleet (je maten + voorkeuren). We zetten dan <strong>50 spaarpunten</strong> op je voucherkaart, en je krijgt voortaan advies en aanbiedingen die echt bij je passen.</p>
    </td></tr>
    <tr><td style="padding:18px 28px 28px">
      <a href="${url}" style="display:inline-block;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 24px;text-decoration:none">Profiel afronden (+50 punten)</a>
      <p style="font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.6;margin-top:14px">Duurt een halve minuut; de punten staan er meteen op.</p>
    </td></tr>`;
  return sendEmail(email, "Rond je GENTS-profiel af — 50 punten cadeau", shell(inner));
}

/** Reservering-bevestiging: "we houden 'm 7 dagen voor je vast" + afreken-link
 *  (online afrekenen → onbeperkt vasthouden). */
export async function sendReserveringEmail(input: {
  to: string; name?: string; store: string; validUntil?: Date | string | null;
  lines: { title?: string; sku?: string; size?: string; color?: string; qty?: number }[]; payToken?: string;
}): Promise<boolean> {
  // Naam escapen: sinds reserveer-om-te-passen is dit veld publiek beïnvloedbaar
  // (HTML-injectie in een gebrande mail = phishing-kanaal).
  const hi = input.name ? `Hoi ${String(input.name).replace(/</g, "&lt;")},` : "Hoi,";
  const tot = input.validUntil ? new Date(input.validUntil).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "";
  const itemsHtml = (input.lines || []).map((l) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #EAEAEA">
      <div style="font:700 14px Arial,sans-serif;color:#0A0A0A">${(l.title || l.sku || "Artikel").replace(/</g, "&lt;")}</div>
      <div style="font:12px Arial,sans-serif;color:#6B6B6B;margin-top:2px">${[l.color, l.size && `maat ${l.size}`, l.qty ? `${l.qty}×` : ""].filter(Boolean).join(" · ")}</div>
    </td></tr>`).join("");
  const payUrl = input.payToken ? `${getSiteUrl()}/reservering-afrekenen?token=${encodeURIComponent(input.payToken)}` : "";
  const cta = payUrl ? `
    <tr><td style="padding:6px 28px 28px">
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0 0 12px">Wil je 'm langer vasthouden? Reken je reservering online af — dan houden we 'm <strong>onbeperkt</strong> voor je vast tot je 'm ophaalt.</p>
      <a href="${payUrl}" style="display:inline-block;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 24px;text-decoration:none">Online afrekenen</a>
    </td></tr>` : "";
  const inner = `
    <tr><td style="padding:24px 28px 4px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">We houden 'm voor je apart</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${hi} je reservering staat klaar in <strong>${input.store.replace(/</g, "&lt;")}</strong>${tot ? ` — we houden 'm tot en met <strong>${tot}</strong> voor je vast` : ""}.</p>
    </td></tr>
    <tr><td style="padding:8px 28px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>
    </td></tr>
    ${cta}`;
  return sendEmail(input.to, `We houden je reservering vast in ${input.store}`, shell(inner));
}

/** Winkel-notificatie: klant reserveerde via de site om te passen (intern → NL).
 *  Klant als reply-to zodat de winkel direct kan reageren. */
export async function sendReservationStoreNotify(n: {
  to: string; store: string; customerName: string; customerEmail: string; customerPhone: string;
  title: string; size: string; color: string; validUntil: Date | string | null;
}): Promise<boolean> {
  if (!emailConfigured() || !n.to) return false;
  const tot = n.validUntil ? new Date(n.validUntil).toLocaleDateString("nl-NL", { day: "numeric", month: "long" }) : "";
  const lines = [
    `Nieuwe pas-reservering via gents.nl voor ${n.store}:`,
    "",
    `Artikel: ${n.title}`,
    [n.color, n.size && `maat ${n.size}`].filter(Boolean).join(" · "),
    "",
    `Klant: ${n.customerName}`,
    `E-mail: ${n.customerEmail}`,
    n.customerPhone ? `Telefoon: ${n.customerPhone}` : "",
    "",
    `Leg het artikel apart — de voorraad is al vastgehouden${tot ? ` t/m ${tot}` : ""}.`,
    "De reservering staat ook in het kassa-reserveringenoverzicht.",
  ].filter(Boolean);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [n.to],
      reply_to: n.customerEmail || undefined,
      subject: `Pas-reservering — ${n.title}${n.size ? ` (maat ${n.size})` : ""}`,
      text: lines.join("\n"),
    }),
  });
  if (!res.ok) {
    console.error("[email] pas-reservering winkelnotificatie Resend-fout:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}

/** Double-opt-in: bevestigingsmail voor de nieuwsbrief. */
export async function sendNewsletterConfirmation(email: string, confirmUrl: string): Promise<boolean> {
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">Bevestig je inschrijving</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">
        Nog één klik en je ontvangt als eerste onze nieuwe collecties, styling-tips en exclusieve aanbiedingen.
      </p>
    </td></tr>
    <tr><td style="padding:12px 28px 28px">
      <a href="${confirmUrl}" style="display:inline-block;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 22px;text-decoration:none">Ja, schrijf me in</a>
      <p style="font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.6;margin-top:16px">
        Heb je je niet aangemeld? Negeer deze mail — er gebeurt niets.
      </p>
    </td></tr>`;
  return sendEmail(email, "Bevestig je GENTS-nieuwsbrief", shell(inner));
}

export async function sendOrderConfirmation(order: OrderInfo, lines: OrderLine[], recs: CrossSellItem[] = []): Promise<boolean> {
  if (!emailConfigured()) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [order.email],
      subject: `Je GENTS-bestelling ${order.orderNumber} is bevestigd`,
      html: orderHtml(order, lines, recs),
    }),
  });
  if (!res.ok) {
    console.error("[email] Resend-fout:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}

/* ── Conceptbestelling (kassa: "denk er nog over na") ── */

type ConceptOrderEmail = {
  email: string;
  firstName: string;
  orderNumber: string;
  checkoutUrl: string;
  store: string;
  items: { title: string; size: string; color: string; qty: number; unitPriceCents: number }[];
};

/** Concept van de kassa: de klant twijfelt nog → krijgt z'n selectie gemaild met
 *  een afrond-link. Rondt 'ie af, dan gaat de omzet naar de winkel. */
export async function sendConceptOrderMail(c: ConceptOrderEmail): Promise<boolean> {
  const hi = c.firstName ? `Hoi ${c.firstName},` : "Hoi,";
  const rows = c.items
    .map(
      (l) => `<tr><td style="padding:6px 0;border-bottom:1px solid #E6E4DF;font:14px Arial,sans-serif;color:#0A0A0A">
        ${l.title}<div style="color:#8B8B8B;font-size:12px">${[l.color, l.size && `maat ${l.size}`, `${l.qty}×`].filter(Boolean).join(" · ")}</div></td>
        <td align="right" style="padding:6px 0;border-bottom:1px solid #E6E4DF;font:14px Arial,sans-serif;color:#0A0A0A">${euro(l.unitPriceCents * l.qty)}</td></tr>`,
    )
    .join("");
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">Je selectie staat klaar</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${hi} je was bij <strong>${c.store}</strong> en wilde er nog even over nadenken — geen probleem. Hieronder je selectie. Rond 'm af wanneer je wilt; we leggen 'm dan voor je klaar of bezorgen 'm.</p>
    </td></tr>
    <tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
    <tr><td style="padding:18px 28px 28px">
      <a href="${c.checkoutUrl}" style="display:inline-block;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 24px;text-decoration:none">Bestelling afronden</a>
      <p style="font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.6;margin-top:14px">De link blijft geldig — geen haast. Vragen? Antwoord gerust op deze mail.</p>
    </td></tr>`;
  return sendEmail(c.email, `Je GENTS-selectie van ${c.store} — rond af wanneer je wilt`, shell(inner));
}

/* ── Retouren ── */

type ReturnRegisteredEmail = {
  email: string;
  firstName: string;
  orderNumber: string;
  method: "dhl" | "store";
  refundType: "money" | "credit";
  items: { title: string; size: string; color: string; qty: number }[];
  labelUrl: string;
  tracking: string;
  itemsCents: number;
  shippingCostCents: number;
  pickupStore: string;
};

/** Bevestiging dat de retour is aangemeld — met DHL-label of winkel-instructie. */
export async function sendReturnRegistered(r: ReturnRegisteredEmail): Promise<boolean> {
  const site = getSiteUrl();
  const hi = r.firstName ? `Hoi ${r.firstName},` : "Hoi,";
  const itemRows = r.items
    .map(
      (l) => `<tr><td style="padding:6px 0;border-bottom:1px solid #E6E4DF;font:14px Arial,sans-serif;color:#0A0A0A">
        ${l.title}<div style="color:#8B8B8B;font-size:12px">${[l.color, l.size && `maat ${l.size}`, `${l.qty}×`].filter(Boolean).join(" · ")}</div></td></tr>`,
    )
    .join("");
  const deliveryBlock =
    r.method === "dhl"
      ? r.labelUrl
        ? `<tr><td style="padding:8px 28px 0">
             <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0">Print je <strong>DHL-retourlabel</strong>, plak het op het pakket en lever het in bij een DHL-punt.</p>
             <a href="${r.labelUrl}" style="display:inline-block;margin-top:12px;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 22px;text-decoration:none">Download retourlabel</a>
             ${r.tracking ? `<p style="font:12px Arial,sans-serif;color:#8B8B8B;margin:10px 0 0">Track &amp; trace: ${r.tracking}</p>` : ""}
           </td></tr>`
        : `<tr><td style="padding:8px 28px 0"><p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0">We sturen je het <strong>DHL-retourlabel</strong> zo snel mogelijk per e-mail toe.</p></td></tr>`
      : `<tr><td style="padding:8px 28px 0"><p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0">Lever de artikelen samen met je bestelnummer in bij <strong>${r.pickupStore || "een van onze GENTS-winkels"}</strong>. Inleveren is gratis.</p></td></tr>`;
  const refundLine =
    r.refundType === "credit"
      ? `Je ontvangt <strong>GENTS-tegoed</strong> van ${euro(r.itemsCents)} zodra we de artikelen hebben ontvangen en gecontroleerd.`
      : `Je krijgt ${euro(Math.max(0, r.itemsCents - r.shippingCostCents))} terug op je betaalmethode zodra we de artikelen hebben ontvangen${r.shippingCostCents ? ` (na aftrek van ${euro(r.shippingCostCents)} retourkosten)` : ""}.`;
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">Je retour is aangemeld</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${hi} we hebben je retour voor bestelling <strong>${r.orderNumber}</strong> ontvangen.</p>
    </td></tr>
    <tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table></td></tr>
    ${deliveryBlock}
    <tr><td style="padding:16px 28px 8px"><p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0">${refundLine}</p></td></tr>
    <tr><td style="padding:8px 28px 28px"><p style="font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.6;margin:0">Volg de status van je retour in <a href="${site}/account" style="color:#0A0A0A">Mijn GENTS</a>.</p></td></tr>`;
  return sendEmail(r.email, `Je GENTS-retour voor ${r.orderNumber} is aangemeld`, shell(inner));
}

type ReturnRefundedEmail = {
  email: string;
  firstName: string;
  orderNumber: string;
  refundType: "money" | "credit";
  amountCents: number;
  creditCode: string;
};

/** Retour verwerkt: geld teruggestort, of tegoed-code uitgegeven. */
export async function sendReturnRefunded(r: ReturnRefundedEmail): Promise<boolean> {
  const site = getSiteUrl();
  const hi = r.firstName ? `Hoi ${r.firstName},` : "Hoi,";
  if (r.refundType === "credit") {
    const inner = `
      <tr><td style="padding:24px 28px 8px">
        <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">Je GENTS-tegoed staat klaar</h1>
        <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${hi} we hebben je retour voor bestelling <strong>${r.orderNumber}</strong> verwerkt. Hieronder je tegoed.</p>
      </td></tr>
      <tr><td style="padding:8px 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #0A0A0A">
          <tr><td align="center" style="padding:22px 16px;background:#0A0A0A">
            <div style="font:11px Arial,sans-serif;letter-spacing:3px;color:#C9A14A">GENTS-TEGOED</div>
            <div style="font:600 34px Arial,sans-serif;color:#fff;margin:6px 0">${euro(r.amountCents)}</div>
            <div style="display:inline-block;background:#fff;color:#0A0A0A;font:700 20px 'Courier New',monospace;letter-spacing:2px;padding:10px 18px">${r.creditCode}</div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:12px 28px 28px">
        <p style="font:13px Arial,sans-serif;color:#2C2C2C;line-height:1.7;margin:0">Vul de code bij het afrekenen in onder “Cadeaubon”. Je kunt 'm in meerdere keren gebruiken tot het saldo op is.</p>
        <a href="${site}" style="display:inline-block;margin-top:14px;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 22px;text-decoration:none">Kies iets nieuws</a>
      </td></tr>`;
    return sendEmail(r.email, "Je GENTS-tegoed staat klaar", shell(inner));
  }
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">Je retour is terugbetaald</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${hi} we hebben <strong>${euro(r.amountCents)}</strong> teruggestort op je betaalmethode voor je retour van bestelling <strong>${r.orderNumber}</strong>. Afhankelijk van je bank zie je het binnen enkele werkdagen terug.</p>
    </td></tr>
    <tr><td style="padding:8px 28px 28px"><p style="font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.6;margin:0">Bekijk je retouren in <a href="${site}/account" style="color:#0A0A0A">Mijn GENTS</a>.</p></td></tr>`;
  return sendEmail(r.email, `Je GENTS-retour voor ${r.orderNumber} is terugbetaald`, shell(inner));
}

/* ── Klantafspraken (/afspraak) ── */

const esc = (s: string) => String(s || "").replace(/</g, "&lt;");

type AppointmentEmail = {
  to: string;
  /** Vertaalde teksten (getT(locale) in de route) — de mail volgt de taal van de aanvraag. */
  subject: string;
  heading: string;
  body: string;
  rows: { label: string; value: string }[];
  outro: string;
};

/** Bevestiging van een afspraakaanvraag naar de klant — huisstijl-shell, teksten
 *  komen vertaald binnen zodat een /en- of /de-klant de mail in zijn taal krijgt. */
export async function sendAppointmentConfirmation(a: AppointmentEmail): Promise<boolean> {
  const detailRows = a.rows
    .map(
      (r) => `<tr>
        <td style="padding:6px 12px 6px 0;border-bottom:1px solid #E6E4DF;font:13px Arial,sans-serif;color:#8B8B8B;white-space:nowrap">${esc(r.label)}</td>
        <td style="padding:6px 0;border-bottom:1px solid #E6E4DF;font:14px Arial,sans-serif;color:#0A0A0A">${esc(r.value)}</td>
      </tr>`,
    )
    .join("");
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">${esc(a.heading)}</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${esc(a.body)}</p>
    </td></tr>
    <tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${detailRows}</table></td></tr>
    <tr><td style="padding:16px 28px 28px">
      <p style="font:13px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0">${esc(a.outro)}</p>
    </td></tr>`;
  return sendEmail(a.to, a.subject, shell(inner));
}

type AppointmentStoreNotify = {
  to: string;
  store: string;
  typeLabel: string;
  preferredDate: string;
  dagdeel: string;
  name: string;
  phone: string;
  wensen: string;
  customerEmail: string;
};

/** Notificatie naar de winkel: nieuwe afspraakaanvraag (intern → NL). De klant
 *  staat als reply-to zodat de winkel direct kan reageren om het tijdstip af te stemmen. */
export async function sendAppointmentStoreNotify(n: AppointmentStoreNotify): Promise<boolean> {
  if (!emailConfigured() || !n.to) return false;
  const lines = [
    `Type: ${n.typeLabel}`,
    `Winkel: ${n.store}`,
    `Gewenste datum: ${n.preferredDate}`,
    `Dagdeel: ${n.dagdeel}`,
    `Naam: ${n.name}`,
    n.phone ? `Telefoon: ${n.phone}` : "",
    n.wensen ? `Wensen: ${n.wensen}` : "",
    "",
    "Neem contact op met de klant om het exacte tijdstip te bevestigen.",
  ].filter(Boolean);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [n.to],
      reply_to: n.customerEmail,
      subject: `Nieuwe afspraakaanvraag — ${n.typeLabel} — ${n.preferredDate}`,
      text: lines.join("\n"),
    }),
  });
  if (!res.ok) {
    console.error("[email] afspraak-winkelnotificatie Resend-fout:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}
