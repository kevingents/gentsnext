import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { newsletterSubscribers } from "@/db/schema";
import { normalizePhone } from "@/lib/whatsapp";
import { emailConfigured, sendNewsletterConfirmation } from "@/lib/email";
import { newsletterToken, pushEmailToResendAudience } from "@/lib/newsletter";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * Nieuwsbrief-aanmelding met kanaalkeuze: e-mail óf WhatsApp. Alles wordt in de
 * eigen store (newsletter_subscribers) bewaard — de bron van waarheid. E-mail
 * gaat via double-opt-in: 'pending' + bevestigingsmail, pas na de klik
 * 'subscribed' + naar de Resend-audience. AVG: alleen bij expliciete opt-in.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }

  const channel = body?.channel === "whatsapp" ? "whatsapp" : "email";
  const source = ["site", "checkout", "popup"].includes(String(body?.source)) ? String(body?.source) : "site";
  const db = getDb();

  if (channel === "whatsapp") {
    const phone = normalizePhone(String(body?.phone || ""));
    if (!phone) return NextResponse.json({ ok: false, error: "ongeldig telefoonnummer" }, { status: 400 });
    const existing = await db
      .select({ id: newsletterSubscribers.id })
      .from(newsletterSubscribers)
      .where(and(eq(newsletterSubscribers.channel, "whatsapp"), eq(newsletterSubscribers.phone, phone)))
      .limit(1);
    if (existing.length) {
      await db
        .update(newsletterSubscribers)
        .set({ status: "subscribed", updatedAt: sql`now()` })
        .where(eq(newsletterSubscribers.id, existing[0].id));
    } else {
      await db.insert(newsletterSubscribers).values({ channel: "whatsapp", phone, source, status: "subscribed" });
    }
    return NextResponse.json({ ok: true });
  }

  // E-mail
  const email = String(body?.email || "").trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) {
    return NextResponse.json({ ok: false, error: "ongeldig e-mailadres" }, { status: 400 });
  }
  const existing = await db
    .select({ id: newsletterSubscribers.id, status: newsletterSubscribers.status })
    .from(newsletterSubscribers)
    .where(and(eq(newsletterSubscribers.channel, "email"), eq(newsletterSubscribers.email, email)))
    .limit(1);

  // Al bevestigd? Niets te doen — geen dubbele mail.
  if (existing.length && existing[0].status === "subscribed") {
    return NextResponse.json({ ok: true });
  }

  // Double-opt-in: alleen op 'pending' zetten + bevestigingsmail sturen. Pas na
  // het klikken in de mail wordt de inschrijving definitief (zie /confirm).
  if (emailConfigured()) {
    if (existing.length) {
      await db.update(newsletterSubscribers).set({ status: "pending", updatedAt: sql`now()` }).where(eq(newsletterSubscribers.id, existing[0].id));
    } else {
      await db.insert(newsletterSubscribers).values({ channel: "email", email, source, status: "pending" });
    }
    const url = `${getSiteUrl()}/api/newsletter/confirm?email=${encodeURIComponent(email)}&token=${newsletterToken(email)}`;
    await sendNewsletterConfirmation(email, url);
    return NextResponse.json({ ok: true, pending: true });
  }

  // Geen mailinfra (dev/zonder Resend): direct inschrijven zoals voorheen.
  if (existing.length) {
    await db.update(newsletterSubscribers).set({ status: "subscribed", updatedAt: sql`now()` }).where(eq(newsletterSubscribers.id, existing[0].id));
  } else {
    await db.insert(newsletterSubscribers).values({ channel: "email", email, source, status: "subscribed" });
  }
  const ok = await pushEmailToResendAudience(email);
  return NextResponse.json({ ok }, { status: ok ? 200 : 502 });
}
