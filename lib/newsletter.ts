import { createHmac } from "node:crypto";
import { tokenEquals } from "@/lib/timing-safe";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { newsletterSubscribers } from "@/db/schema";
import { normalizePhone } from "@/lib/whatsapp";

/**
 * Stateless double-opt-in-token voor de nieuwsbrief (geen extra DB-kolom nodig).
 * HMAC over het e-mailadres met een server-secret. Tip: zet NEWSLETTER_SECRET in
 * Vercel; zonder valt 'ie terug op de Resend-key (tokens verlopen bij key-rotatie).
 */
const KEY = process.env.NEWSLETTER_SECRET || process.env.RESEND_API_KEY || "gents-newsletter-fallback";

export function newsletterToken(email: string): string {
  return createHmac("sha256", KEY).update(email.trim().toLowerCase()).digest("base64url");
}

export function verifyNewsletterToken(email: string, token: string): boolean {
  return tokenEquals(token, newsletterToken(email));
}

/** E-mail-opt-in naar de Resend-audience (env-gated; stub als niet geconfigureerd). */
export async function pushEmailToResendAudience(email: string): Promise<boolean> {
  const audience = process.env.RESEND_AUDIENCE_ID;
  const apiKey = process.env.RESEND_API_KEY;
  if (!audience || !apiKey) {
    console.log("[newsletter] (stub) e-mail-opt-in:", email);
    return true;
  }
  try {
    const r = await fetch(`https://api.resend.com/audiences/${audience}/contacts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, unsubscribed: false }),
    });
    if (!r.ok && r.status !== 409) {
      console.error("[newsletter] Resend-fout:", r.status, (await r.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[newsletter] fetch-fout:", e);
    return false;
  }
}

/**
 * Afmelden bij Resend. Zonder deze stap blijft iemand die zich in zijn account
 * uitschrijft gewoon mail krijgen: onze eigen store zegt dan "unsubscribed",
 * maar de campagne draait op de Resend-audience. 404 = staat er niet (meer),
 * dat is voor ons ook goed.
 */
export async function unsubscribeEmailFromResendAudience(email: string): Promise<boolean> {
  const audience = process.env.RESEND_AUDIENCE_ID;
  const apiKey = process.env.RESEND_API_KEY;
  if (!audience || !apiKey) {
    console.log("[newsletter] (stub) e-mail-opt-out:", email);
    return true;
  }
  try {
    const r = await fetch(
      `https://api.resend.com/audiences/${audience}/contacts/${encodeURIComponent(email)}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ unsubscribed: true }),
      }
    );
    if (!r.ok && r.status !== 404) {
      console.error("[newsletter] Resend-afmeldfout:", r.status, (await r.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[newsletter] fetch-fout:", e);
    return false;
  }
}

/* ── Voorkeuren van één klant ─────────────────────────────────────────────── */

/** 'none' = nooit ingeschreven; 'pending' = wel aangemeld, mail nog niet bevestigd. */
export type ChannelStatus = "subscribed" | "pending" | "unsubscribed" | "none";
export type NewsletterPrefs = { email: ChannelStatus; whatsapp: ChannelStatus; phone: string };

/**
 * Stand van zaken per kanaal voor deze klant. WhatsApp hangt aan het
 * telefoonnummer, niet aan het account — zonder nummer valt er niets te tonen.
 */
export async function getNewsletterPrefs(email: string, phone: string): Promise<NewsletterPrefs> {
  const db = getDb();
  const mail = String(email || "").trim().toLowerCase();
  const tel = normalizePhone(phone || "");

  const [mailRow, telRow] = await Promise.all([
    mail
      ? db
          .select({ status: newsletterSubscribers.status })
          .from(newsletterSubscribers)
          .where(and(eq(newsletterSubscribers.channel, "email"), eq(newsletterSubscribers.email, mail)))
          .limit(1)
      : Promise.resolve([] as { status: string }[]),
    tel
      ? db
          .select({ status: newsletterSubscribers.status })
          .from(newsletterSubscribers)
          .where(and(eq(newsletterSubscribers.channel, "whatsapp"), eq(newsletterSubscribers.phone, tel)))
          .limit(1)
      : Promise.resolve([] as { status: string }[]),
  ]);

  const as = (rows: { status: string }[]): ChannelStatus =>
    rows.length ? (rows[0].status as ChannelStatus) : "none";

  return { email: as(mailRow), whatsapp: as(telRow), phone: tel || "" };
}

/**
 * In/uitschrijven vanuit het ingelogde account. Hier hoeft géén double-opt-in
 * overheen: de klant is ingelogd op dit e-mailadres, dus het eigenaarschap
 * staat al vast — een bevestigingsmail zou alleen maar een extra drempel zijn
 * (en zorgt voor "ik heb 'm aangezet maar er gebeurt niets").
 */
export async function setEmailSubscription(email: string, on: boolean): Promise<void> {
  const db = getDb();
  const mail = String(email || "").trim().toLowerCase();
  if (!mail) return;
  const status = on ? "subscribed" : "unsubscribed";
  const rows = await db
    .select({ id: newsletterSubscribers.id })
    .from(newsletterSubscribers)
    .where(and(eq(newsletterSubscribers.channel, "email"), eq(newsletterSubscribers.email, mail)))
    .limit(1);
  if (rows.length) {
    await db
      .update(newsletterSubscribers)
      .set({ status, updatedAt: sql`now()` })
      .where(eq(newsletterSubscribers.id, rows[0].id));
  } else {
    await db.insert(newsletterSubscribers).values({ channel: "email", email: mail, source: "site", status });
  }
  if (on) await pushEmailToResendAudience(mail);
  else await unsubscribeEmailFromResendAudience(mail);
}

/** Idem voor WhatsApp; `phone` mag ruw zijn, we normaliseren hier. */
export async function setWhatsappSubscription(phone: string, on: boolean): Promise<boolean> {
  const tel = normalizePhone(phone || "");
  if (!tel) return false;
  const db = getDb();
  const status = on ? "subscribed" : "unsubscribed";
  const rows = await db
    .select({ id: newsletterSubscribers.id })
    .from(newsletterSubscribers)
    .where(and(eq(newsletterSubscribers.channel, "whatsapp"), eq(newsletterSubscribers.phone, tel)))
    .limit(1);
  if (rows.length) {
    await db
      .update(newsletterSubscribers)
      .set({ status, updatedAt: sql`now()` })
      .where(eq(newsletterSubscribers.id, rows[0].id));
  } else {
    await db.insert(newsletterSubscribers).values({ channel: "whatsapp", phone: tel, source: "site", status });
  }
  return true;
}
