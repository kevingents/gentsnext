import { NextResponse } from "next/server";
import { getReservationByPayToken, reservationAmountCents, type ReservationLine } from "@/lib/reservations";
import { createMolliePayment, mollieConfigured } from "@/lib/mollie";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/reservering/afrekenen — start een Mollie-betaling voor een reservering.
 * Publiek, token-gated (de pay-token uit de mail). We maken hier NOG GEEN order: de
 * reservering blijft vastgehouden tot de betaling binnen is. Bij 'paid' converteert
 * de Mollie-webhook de reservering naar een betaalde afhaalorder.
 *
 *   Body: { token } → { ok, checkoutUrl } | { ok, alreadyDone }
 */
export async function POST(req: Request) {
  let b: { token?: string };
  try { b = (await req.json()) as { token?: string }; } catch { return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 }); }
  const token = String(b?.token || "").trim();
  if (!token) return NextResponse.json({ ok: false, error: "Token ontbreekt." }, { status: 400 });

  const r = await getReservationByPayToken(token);
  if (!r) return NextResponse.json({ ok: false, error: "Deze link is niet geldig." }, { status: 404 });
  if (r.status === "converted" || r.paid) return NextResponse.json({ ok: true, alreadyDone: true });
  if (r.status !== "open") return NextResponse.json({ ok: false, error: "Deze reservering is niet meer actief." }, { status: 400 });

  const amountCents = reservationAmountCents((Array.isArray(r.lines) ? r.lines : []) as ReservationLine[]);
  if (amountCents <= 0) return NextResponse.json({ ok: false, error: "Geen bedrag om af te rekenen." }, { status: 400 });
  if (!mollieConfigured()) return NextResponse.json({ ok: false, error: "Online betalen is nog niet beschikbaar." }, { status: 503 });

  // Canonieke site-URL (nooit de client-Host) voor webhook/redirect — host-header-
  // injectie mag een betaal-callback niet kunnen wegkapen.
  const origin = getSiteUrl();
  try {
    const payment = await createMolliePayment({
      amountCents,
      description: `GENTS reservering — afhalen in ${r.location}`,
      redirectUrl: `${origin}/reservering-afrekenen?token=${encodeURIComponent(token)}&betaald=1`,
      cancelUrl: `${origin}/reservering-afrekenen?token=${encodeURIComponent(token)}`,
      webhookUrl: `${origin}/api/webhooks/mollie`,
      metadata: { kind: "reservation", reservationId: r.id },
      // Uniek per poging: een STATISCHE key liet Mollie na annuleren ~24u de dode
      // betaling replayen → reservering online onbetaalbaar. Nu start elke poging vers.
      idempotencyKey: `reservation-${r.id}-${Date.now().toString(36)}`,
    });
    if (!payment.checkoutUrl) return NextResponse.json({ ok: false, error: "Betaling kon niet worden gestart." }, { status: 502 });
    return NextResponse.json({ ok: true, checkoutUrl: payment.checkoutUrl });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Betaling mislukt." }, { status: 502 });
  }
}
