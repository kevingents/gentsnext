import { getSiteUrl } from "@/lib/site-url";
import { emailConfigured, brandedEmailHtml, mailT } from "@/lib/email";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { DEFAULT_LOCALE, isLocale, localizedPath, type Locale } from "@/lib/i18n";

/**
 * Order-status-updates naar de klant via e-mail én WhatsApp. De
 * orderbevestiging (betaald) heeft een eigen rijke HTML-mail (lib/email); hier
 * zitten de statusovergangen 'verzonden', 'klaar om af te halen', 'bezorgd'
 * (met review-uitnodiging) en 'terugbetaald'. WhatsApp en e-mail zijn env-gated
 * (zonder koppeling: stub-log).
 *
 * Taal: deze mails vertrekken uit het back-office, dagen na de bestelling — de
 * enige betrouwbare bron voor de klanttaal is dan orders.locale, die de
 * aanroeper meegeeft. Onbekend/leeg → Nederlands.
 */

type OrderForNotify = {
  orderNumber: string;
  email: string;
  firstName: string;
  phone: string;
  accessToken?: string | null;
  /** Taal waarin besteld is (orders.locale); leeg/onbekend → nl. */
  locale?: string | null;
};

type Tr = (key: string, params?: Record<string, string | number>) => string;
type Ctx = { orderUrl: string; reviewUrl: string };
type Msg = { subject: string; heading: string; text: string; ctaUrl: string; ctaLabel: string };

const MESSAGES: Record<string, (o: OrderForNotify, c: Ctx, t: Tr) => Msg> = {
  shipped: (o, c, t) => ({
    subject: t("mail.status.shipped.subject", { orderNumber: o.orderNumber }),
    heading: t("order.status.shippedTitle"),
    text: t("mail.status.shipped.text", { name: o.firstName || t("mail.greeting.fallbackName"), orderNumber: o.orderNumber }),
    ctaUrl: c.orderUrl,
    ctaLabel: t("order.track_order_title"),
  }),
  ready_pickup: (o, c, t) => ({
    subject: t("mail.status.readyPickup.subject", { orderNumber: o.orderNumber }),
    heading: t("order.status.readyPickupTitle"),
    text: t("mail.status.readyPickup.text", { name: o.firstName || t("mail.greeting.fallbackName"), orderNumber: o.orderNumber }),
    ctaUrl: c.orderUrl,
    ctaLabel: t("mail.status.viewOrder"),
  }),
  delivered: (o, c, t) => ({
    subject: t("mail.status.delivered.subject"),
    heading: t("mail.status.delivered.heading"),
    text: t("mail.status.delivered.text", { name: o.firstName || t("mail.greeting.fallbackName"), orderNumber: o.orderNumber }),
    ctaUrl: c.reviewUrl,
    ctaLabel: t("order.write_review"),
  }),
  refunded: (o, c, t) => ({
    subject: t("mail.status.refunded.subject", { orderNumber: o.orderNumber }),
    heading: t("order.status.refundedTitle"),
    text: t("mail.status.refunded.text", { name: o.firstName || t("mail.greeting.fallbackName"), orderNumber: o.orderNumber }),
    ctaUrl: c.orderUrl,
    ctaLabel: t("mail.status.viewOrder"),
  }),
};

export async function notifyOrderStatus(order: OrderForNotify, status: string): Promise<void> {
  const make = MESSAGES[status];
  if (!make) return;
  const base = getSiteUrl();
  const locale: Locale = isLocale(String(order.locale || "")) ? (order.locale as Locale) : DEFAULT_LOCALE;
  const t = await mailT(locale);
  const q = order.accessToken ? `?t=${order.accessToken}` : "";
  // Links met locale-prefix (/en/bestelling/…), zodat de klant ook op de site
  // in zijn eigen taal terechtkomt; nl blijft prefix-loos.
  const ctx: Ctx = {
    orderUrl: `${base}${localizedPath(`/bestelling/${order.orderNumber}`, locale)}${q}`,
    reviewUrl: `${base}${localizedPath(`/review/${order.orderNumber}`, locale)}${q}`,
  };
  const { subject, heading, text, ctaUrl, ctaLabel } = make(order, ctx, t);

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
            locale,
            t,
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
