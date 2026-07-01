import { NextResponse } from "next/server";
import { getWorldlineCheckoutStatus } from "@/lib/worldline";
import {
  applyPaymentStatus,
  sendOrderConfirmationOnce,
  planAndPushFulfillmentOnce,
  releaseOrderGiftcard,
  paymentRefForOrderNumber,
} from "@/lib/orders";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Terugkeer-route na Worldline Hosted Checkout. De klant landt hier (Worldline hangt
 * hostedCheckoutId + RETURNMAC aan de URL); we passen de status meteen toe zodat de
 * klant direct 'betaald' ziet — de webhook is de onafhankelijke backup — en sturen
 * dan door naar de bevestigingspagina. De status komt uit de GET (bron van waarheid),
 * NOOIT uit de query, dus de URL is niet te manipuleren naar 'betaald'.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderNumber = url.searchParams.get("on") || "";
  const token = url.searchParams.get("t") || "";
  const dest = orderNumber
    ? `${url.origin}/bestelling/${encodeURIComponent(orderNumber)}?t=${encodeURIComponent(token)}`
    : `${url.origin}/`;

  try {
    const ref = orderNumber ? await paymentRefForOrderNumber(orderNumber) : "";
    if (ref) {
      const status = await getWorldlineCheckoutStatus(ref);
      await applyPaymentStatus(ref, status.canonical);
      if (status.canonical === "paid") {
        await sendOrderConfirmationOnce(ref);
        await planAndPushFulfillmentOnce(ref);
      } else if (["canceled", "expired", "failed"].includes(status.canonical)) {
        await releaseOrderGiftcard(ref);
      }
    }
  } catch (e) {
    console.error("[worldline return]", e);
  }
  return NextResponse.redirect(dest, 303);
}
