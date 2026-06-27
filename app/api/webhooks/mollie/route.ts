import { NextResponse } from "next/server";
import { getMolliePayment, mollieConfigured } from "@/lib/mollie";
import {
  applyPaymentStatus,
  sendOrderConfirmationOnce,
  planAndPushFulfillmentOnce,
  releaseOrderGiftcard,
} from "@/lib/orders";
import { applyGiftcardPaymentStatus } from "@/lib/giftcards";
import { convertReservationToOrder } from "@/lib/reservations";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Mollie-betaalwebhook. Mollie POST't alleen een payment-id (form-encoded);
 * de status haal je zelf op met de API-key (bron van waarheid). Idempotent —
 * Mollie kan dezelfde webhook meermaals sturen.
 *
 * Altijd 200 terug bij een verwerkt id, zodat Mollie niet blijft retryen.
 */
export async function POST(req: Request) {
  if (!mollieConfigured()) return NextResponse.json({ ok: true });

  let id = "";
  try {
    const form = await req.formData();
    id = String(form.get("id") || "");
  } catch {
    try {
      const text = await req.text();
      id = new URLSearchParams(text).get("id") || "";
    } catch {
      /* leeg laten */
    }
  }
  if (!id) return NextResponse.json({ ok: false, error: "geen id" }, { status: 400 });

  try {
    const payment = await getMolliePayment(id);

    // Cadeaubon-aankoop (eigen flow) — activeer + mail de bon, geen order.
    if (payment.metadata && (payment.metadata as Record<string, unknown>).kind === "giftcard") {
      await applyGiftcardPaymentStatus(payment.id, payment.status);
      return NextResponse.json({ ok: true });
    }

    // Reservering online afgerekend → converteer naar een betaalde afhaalorder.
    // (Geen order tot betaling binnen is; bij niet-betaald blijft de reservering staan.)
    if (payment.metadata && (payment.metadata as Record<string, unknown>).kind === "reservation") {
      if (payment.status === "paid" || payment.status === "authorized") {
        const reservationId = String((payment.metadata as Record<string, unknown>).reservationId || "");
        if (reservationId) await convertReservationToOrder(reservationId);
      }
      return NextResponse.json({ ok: true });
    }

    await applyPaymentStatus(payment.id, payment.status);
    if (payment.status === "paid" || payment.status === "authorized") {
      await sendOrderConfirmationOnce(payment.id);
      // Allocatie (magazijn-eerst, minimaal splitsen) + SRS-weborder-push.
      await planAndPushFulfillmentOnce(payment.id);
    } else if (["canceled", "expired", "failed"].includes(payment.status)) {
      // Mislukte betaling → een ingezette cadeaubon weer vrijgeven.
      await releaseOrderGiftcard(payment.id);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    // 500 → Mollie retryt later opnieuw (tot 10x over ~26u).
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "webhook-fout" },
      { status: 500 }
    );
  }
}
