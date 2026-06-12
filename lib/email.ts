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
            <tr><td style="padding:4px 0;font:14px Arial,sans-serif;color:#8B8B8B">Verzending</td><td align="right" style="padding:4px 0;font:14px Arial,sans-serif;color:#0A0A0A">${order.shippingCents === 0 ? "Gratis" : euro(order.shippingCents)}</td></tr>
            <tr><td style="padding:8px 0;border-top:1px solid #E6E4DF;font:600 15px Arial,sans-serif;color:#0A0A0A">Totaal</td><td align="right" style="padding:8px 0;border-top:1px solid #E6E4DF;font:600 15px Arial,sans-serif;color:#0A0A0A">${euro(order.totalCents)}</td></tr>
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
