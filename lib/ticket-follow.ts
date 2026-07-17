import crypto from "node:crypto";

/**
 * Volg-link voor een klantenservice-ticket: de klant volgt z'n vraag ZONDER in te
 * loggen. Zelfde vertrouwensmodel als een magic-link (wie de mail heeft, ziet
 * enkel z'n eigen ticket). De token bindt de ref aan het requester-e-mailadres.
 *
 * HMAC-RECEPT — MOET bit-voor-bit gelijk zijn aan storegents lib/ticket-follow-token.js:
 *   secret  = process.env.STOREGENTS_PORTAL_SECRET  (== CUSTOMER_PORTAL_SECRET in storegents)
 *   payload = `${ref.trim()}|${email.trim().toLowerCase()}`
 *   digest  = HMAC-SHA256(secret, payload) → hex (64 tekens, lowercase)
 *
 * Geen nieuw secret (huisregel): hetzelfde gedeelde portal-secret dat we ook voor
 * /api/customer-tickets gebruiken (zie lib/helpdesk.ts). De mails worden door
 * storegents verstuurd; hier verifiëren we de token server-side.
 */

const SECRET = process.env.STOREGENTS_PORTAL_SECRET || "";

/** De payload-string die ondertekend wordt (identiek aan storegents). */
export function followTokenPayload(ref: string, email: string): string {
  return `${String(ref).trim()}|${String(email).trim().toLowerCase()}`;
}

/** HMAC-SHA256 volg-token (hex). Leeg bij ontbrekend secret. */
export function signFollowToken(ref: string, email: string): string {
  if (!SECRET) return "";
  return crypto.createHmac("sha256", SECRET).update(followTokenPayload(ref, email)).digest("hex");
}

/**
 * Constant-time verificatie van een meegegeven token. False bij ontbrekend
 * secret/token of lengteverschil — timingSafeEqual eist gelijke lengte.
 */
export function verifyFollowToken(ref: string, email: string, token: string): boolean {
  const expected = signFollowToken(ref, email);
  if (!expected || !token) return false;
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
