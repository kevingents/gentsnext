import { getSiteUrl } from "@/lib/site-url";
import { emailConfigured, brandedEmailHtml } from "@/lib/email";
import { sendWhatsAppText } from "@/lib/whatsapp";

/**
 * Order-status-updates naar de klant via e-mail én WhatsApp. De
 * orderbevestiging (betaald) heeft een eigen rijke HTML-mail (lib/email); hier
 * zitten de statusovergangen 'verzonden', 'klaar om af te halen', 'bezorgd'
 * (met review-uitnodiging) en 'terugbetaald'. WhatsApp en e-mail zijn env-gated
 * (zonder koppeling: stub-log).
 */

type OrderForNotify = {
  orderNumber: string;
  email: string;
  firstName: string;
  phone: string;
  accessToken?: string | null;
};

type Ctx = { orderUrl: string; reviewUrl: string };
type Msg = { subject: string; heading: string; text: string; ctaUrl: string; ctaLabel: string };

const MESSAGES: Record<string, (o: OrderForNotify, c: Ctx) => Msg> = {
  shipped: (o, c) => ({
    subject: `Je GENTS-bestelling ${o.orderNumber} is verzonden`,
    heading: "Je bestelling is onderweg",
    text: `Hoi ${o.firstName || "daar"}, goed nieuws! Je bestelling ${o.orderNumber} is onderweg.`,
    ctaUrl: c.orderUrl,
    ctaLabel: "Volg je bestelling",
  }),
  ready_pickup: (o, c) => ({
    subject: `Je GENTS-bestelling ${o.orderNumber} ligt klaar`,
    heading: "Je bestelling ligt voor je klaar",
    text: `Hoi ${o.firstName || "daar"}, je bestelling ${o.orderNumber} ligt klaar om af te halen in de winkel. Tot snel!`,
    ctaUrl: c.orderUrl,
    ctaLabel: "Bekijk je bestelling",
  }),
  delivered: (o, c) => ({
    subject: "Hoe bevalt je GENTS-bestelling?",
    heading: "Hoe bevalt je bestelling?",
    text: `Hoi ${o.firstName || "daar"}, je bestelling ${o.orderNumber} is bezorgd. We zijn benieuwd wat je ervan vindt — een korte review helpt andere klanten enorm en kost je maar een minuutje.`,
    ctaUrl: c.reviewUrl,
    ctaLabel: "Schrijf een review",
  }),
  refunded: (o, c) => ({
    subject: `Je GENTS-bestelling ${o.orderNumber} is terugbetaald`,
    heading: "Je bestelling is terugbetaald",
    text: `Hoi ${o.firstName || "daar"}, je betaling voor ${o.orderNumber} is terugbetaald. Vragen? We helpen je graag.`,
    ctaUrl: c.orderUrl,
    ctaLabel: "Bekijk je bestelling",
  }),
};

export async function notifyOrderStatus(order: OrderForNotify, status: string): Promise<void> {
  const make = MESSAGES[status];
  if (!make) return;
  const base = getSiteUrl();
  const q = order.accessToken ? `?t=${order.accessToken}` : "";
  const ctx: Ctx = {
    orderUrl: `${base}/bestelling/${order.orderNumber}${q}`,
    reviewUrl: `${base}/review/${order.orderNumber}${q}`,
  };
  const { subject, heading, text, ctaUrl, ctaLabel } = make(order, ctx);

  // E-mail
  if (emailConfigured() && order.email) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.RESEND_FROM,
          to: [order.email],
          subject,
          html: brandedEmailHtml({
            heading,
            bodyHtml: `<p style="margin:0">${text}</p>`,
            cta: { label: ctaLabel, href: ctaUrl },
          }),
        }),
      });
    } catch (e) {
      console.error("[order-notify] mailfout:", e);
    }
  } else {
    console.log(`[order-notify] (stub mail) ${order.email}: ${subject}`);
  }

  // WhatsApp (als de klant een nummer heeft achtergelaten)
  if (order.phone) {
    await sendWhatsAppText(order.phone, `${text} ${ctaUrl}`);
  }
}
