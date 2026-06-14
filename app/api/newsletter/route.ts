import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { newsletterSubscribers } from "@/db/schema";
import { normalizePhone } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/**
 * Nieuwsbrief-aanmelding met kanaalkeuze: e-mail óf WhatsApp. Alles wordt in de
 * eigen store (newsletter_subscribers) bewaard — de bron van waarheid. E-mail-
 * opt-ins gaan daarnaast naar de Resend-audience (env-gated). AVG: alleen bij
 * expliciete opt-in.
 */
async function pushEmailToResend(email: string): Promise<boolean> {
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
    .select({ id: newsletterSubscribers.id })
    .from(newsletterSubscribers)
    .where(and(eq(newsletterSubscribers.channel, "email"), eq(newsletterSubscribers.email, email)))
    .limit(1);
  if (existing.length) {
    await db
      .update(newsletterSubscribers)
      .set({ status: "subscribed", updatedAt: sql`now()` })
      .where(eq(newsletterSubscribers.id, existing[0].id));
  } else {
    await db.insert(newsletterSubscribers).values({ channel: "email", email, source, status: "subscribed" });
  }
  const ok = await pushEmailToResend(email);
  return NextResponse.json({ ok }, { status: ok ? 200 : 502 });
}
