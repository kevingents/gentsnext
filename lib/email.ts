import { getSiteUrl } from "@/lib/site-url";

/**
 * Transactionele mail via Resend (env-gated op RESEND_API_KEY). Bewust zonder
 * extra SDK: directe call naar de Resend API, net als de Mollie-client.
 * Afzender via RESEND_FROM (bv. "GENTS <bestellingen@gents.nl>").
 */

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

function euro(cents: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(cents / 100);
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

function orderHtml(order: OrderInfo, lines: OrderLine[]): string {
  const site = getSiteUrl();
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

  return `<!doctype html><html lang="nl"><body style="margin:0;background:#F6F5F2;padding:24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #E6E4DF">
        <tr><td style="padding:28px 28px 0">
          <div style="font:300 26px Arial,sans-serif;letter-spacing:6px;color:#0A0A0A">GENTS</div>
          <div style="font:11px Arial,sans-serif;letter-spacing:3px;color:#8B8B8B;margin-top:4px">— SUITS YOU —</div>
        </td></tr>
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
      <div style="font:11px Arial,sans-serif;color:#8B8B8B;margin-top:16px">GENTS — Suits You · Alle prijzen incl. btw</div>
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

  return `<!doctype html><html lang="nl"><body style="margin:0;background:#F6F5F2;padding:24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #E6E4DF">
        <tr><td style="padding:28px 28px 0">
          <div style="font:300 26px Arial,sans-serif;letter-spacing:6px;color:#0A0A0A">GENTS</div>
          <div style="font:11px Arial,sans-serif;letter-spacing:3px;color:#8B8B8B;margin-top:4px">— SUITS YOU —</div>
        </td></tr>
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
      <div style="font:11px Arial,sans-serif;color:#8B8B8B;margin-top:16px">GENTS — Suits You · Alle prijzen incl. btw</div>
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

function shell(inner: string): string {
  return `<!doctype html><html lang="nl"><body style="margin:0;background:#F6F5F2;padding:24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #E6E4DF">
        <tr><td style="padding:28px 28px 0">
          <div style="font:300 26px Arial,sans-serif;letter-spacing:6px;color:#0A0A0A">GENTS</div>
          <div style="font:11px Arial,sans-serif;letter-spacing:3px;color:#8B8B8B;margin-top:4px">— SUITS YOU —</div>
        </td></tr>
        ${inner}
      </table>
      <div style="font:11px Arial,sans-serif;color:#8B8B8B;margin-top:16px">GENTS — Suits You · Alle prijzen incl. btw</div>
    </td></tr></table>
  </body></html>`;
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

export async function sendOrderConfirmation(order: OrderInfo, lines: OrderLine[]): Promise<boolean> {
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
      html: orderHtml(order, lines),
    }),
  });
  if (!res.ok) {
    console.error("[email] Resend-fout:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}
