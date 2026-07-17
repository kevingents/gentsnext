import { NextResponse } from "next/server";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { fetchTicketForFollow, replyToCustomerTicket } from "@/lib/helpdesk";
import { verifyFollowToken } from "@/lib/ticket-follow";

export const dynamic = "force-dynamic";

/**
 * Publieke reply op een ticket via de volg-link (geen login). De klant bewijst
 * eigenaarschap met de ondertekende token (HMAC over ref|e-mail) uit de URL —
 * exact dezelfde verificatie als de volg-pagina. Reuse van het bestaande
 * reply-pad (replyToCustomerTicket → storegents /api/customer-tickets), dat het
 * ticket heropent. Rate-limited per IP én per ref tegen brute-force/misbruik.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const rlIp = rateLimit("vraag-reply-ip:" + fingerprint(ip), 6, 60_000);
  if (!rlIp.ok) {
    return NextResponse.json({ ok: false, error: "Te veel verzoeken — probeer het zo weer." }, { status: 429, headers: { "retry-after": String(rlIp.retryAfterSec) } });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!ref || !token || !text) {
    return NextResponse.json({ ok: false, error: "ref, token en text verplicht" }, { status: 400 });
  }

  // Extra per-ref limiet (naast per-IP) tegen gericht spammen van één ticket.
  const rlRef = rateLimit("vraag-reply-ref:" + fingerprint(ref), 12, 60_000);
  if (!rlRef.ok) {
    return NextResponse.json({ ok: false, error: "Te veel verzoeken — probeer het zo weer." }, { status: 429, headers: { "retry-after": String(rlRef.retryAfterSec) } });
  }

  const found = await fetchTicketForFollow(ref);
  // Uniform: geen onderscheid tussen onbekende ref en fout token.
  if (!found || !verifyFollowToken(ref, found.email, token)) {
    return NextResponse.json({ ok: false, error: "Deze link is niet (meer) geldig." }, { status: 403 });
  }

  const ok = await replyToCustomerTicket(found.email, ref, text);
  if (!ok) return NextResponse.json({ ok: false, error: "Versturen mislukte — probeer het zo opnieuw." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
