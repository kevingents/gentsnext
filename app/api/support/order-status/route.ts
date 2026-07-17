import { NextResponse } from "next/server";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { getSessionCustomer } from "@/lib/account";
import { getDb } from "@/db";
import { supportTickets } from "@/db/schema";
import {
  lookupOrderStatusForEmail,
  lookupOrderStatusVerified,
  ORDER_LOOKUP_NOT_FOUND,
  type SupportOrderStatus,
} from "@/lib/support-orderdata";

export const dynamic = "force-dynamic";

/**
 * POST /api/support/order-status — orderstatus voor de support-widget.
 *
 * Twee paden:
 *  - Gast: { orderNr, postcode } → één order, ALLEEN als de (genormaliseerde)
 *    postcode bij die order hoort. Uniforme fout bij elke miss (geen
 *    enumeratie-oracle), PII alleen in de POST-body (nooit in de URL).
 *  - Ingelogde sessie zonder orderNr: recente orders op het sessie-e-mailadres.
 *
 * Publiek endpoint met PII-uitkomst → rate-limit per IP (10/min, fail-closed)
 * en een respons die nooit meer bevat dan status/T&T/retour/refund.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const rl = rateLimit("support-orderstatus:" + fingerprint(ip), 10, 60000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Te veel verzoeken — probeer het zo weer." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } }
    );
  }

  let body: { orderNr?: string; postcode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }
  const orderNr = String(body.orderNr || "").trim();
  const postcode = String(body.postcode || "").trim();

  // Ingelogde sessie zonder ordernummer: opzoeken op het GEVERIFIEERDE sessie-adres.
  if (!orderNr && !postcode) {
    const customer = await getSessionCustomer().catch(() => null);
    if (!customer?.email) {
      // Fail-closed: geen sessie en geen verificatiegegevens → zelfde uniforme fout.
      return NextResponse.json({ ok: false, error: ORDER_LOOKUP_NOT_FOUND }, { status: 404 });
    }
    try {
      const orders = await lookupOrderStatusForEmail(customer.email);
      await logLookup({ email: customer.email, hit: orders.length > 0, via: "sessie", orders });
      return NextResponse.json({ ok: true, orders });
    } catch {
      return NextResponse.json({ ok: false, error: "Opzoeken lukt even niet — probeer het zo weer." }, { status: 500 });
    }
  }

  // Gast-pad: ordernummer + postcode zijn allebei verplicht; elke miss geeft
  // exact dezelfde melding (onbekend nummer ≠ te onderscheiden van foute postcode).
  if (!orderNr || !postcode) {
    return NextResponse.json({ ok: false, error: ORDER_LOOKUP_NOT_FOUND }, { status: 404 });
  }
  try {
    const order = await lookupOrderStatusVerified(orderNr, postcode);
    await logLookup({ email: "", hit: Boolean(order), via: "formulier", orders: order ? [order] : [] });
    if (!order) {
      return NextResponse.json({ ok: false, error: ORDER_LOOKUP_NOT_FOUND }, { status: 404 });
    }
    return NextResponse.json({ ok: true, orders: [order] });
  } catch {
    // Fail-closed bij twijfel/storing: geen gedeeltelijke data lekken.
    return NextResponse.json({ ok: false, error: "Opzoeken lukt even niet — probeer het zo weer." }, { status: 500 });
  }
}

/**
 * Deflectie-funnel-logging in de bestaande supportTickets-analytics (geen nieuw
 * schema): herkenbare "[orderstatus]"-vlag in het vraagveld, confident=hit,
 * status altijd 'answered' (dit pad maakt nooit een ticket). Er wordt bewust
 * géén ordernummer/postcode gelogd op het gast-pad.
 */
async function logLookup(entry: { email: string; hit: boolean; via: "sessie" | "formulier"; orders: SupportOrderStatus[] }): Promise<void> {
  try {
    const db = getDb();
    await db.insert(supportTickets).values({
      email: entry.email.trim().toLowerCase(),
      question: `[orderstatus] opzoek via ${entry.via}${entry.hit ? "" : " — niet gevonden"}`,
      aiAnswer: entry.hit
        ? entry.orders.map((o) => (entry.via === "sessie" ? `${o.orderNumber}: ${o.statusText}` : o.statusText)).join(" | ")
        : "",
      confident: entry.hit,
      status: "answered",
    });
  } catch {
    /* logging mag niet breken */
  }
}
