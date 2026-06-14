import { createHmac, timingSafeEqual } from "node:crypto";

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
  const expected = newsletterToken(email);
  if (!token || token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
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
