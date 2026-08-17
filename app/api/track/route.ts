import { NextResponse } from "next/server";
import { recordEvents } from "@/lib/analytics";
import { rateLimit, fingerprint } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Ontvangt een batch anonieme storefront-events (geen PII). */
export async function POST(req: Request) {
  // Backstop rate-limit per IP: dit is een publieke, ongeauthenticeerde endpoint —
  // zonder limiet kan iemand er ongelimiteerd rijen in pompen (DB-bloat/kosten).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  if (!rateLimit("track:" + fingerprint(ip), 60, 60000).ok) {
    return NextResponse.json({ ok: true }); // stil negeren, analytics mag de UX nooit breken
  }
  try {
    const body = await req.json();
    const list = Array.isArray(body?.events) ? body.events : Array.isArray(body) ? body : [];
    // 'purchase' wordt AUTORITATIEF server-side geboekt op het betaal-choke-point
    // (lib/orders.ts applyPaymentStatus). Een client-purchase-event zou de omzet/funnel
    // dubbel tellen én is hier vervalsbaar (publiek, ongeauth) → server-side weren.
    const clean = (Array.isArray(list) ? list : []).filter(
      (e) => e && typeof e === "object" && (e as { type?: unknown }).type !== "purchase"
    );
    await recordEvents(clean);
  } catch {
    /* analytics mag nooit de UX breken */
  }
  return NextResponse.json({ ok: true });
}
