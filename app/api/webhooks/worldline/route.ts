import { NextResponse } from "next/server";
import { verifyWorldlineWebhook, getWorldlineCheckoutStatus } from "@/lib/worldline";
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
 * Worldline-betaalwebhook (Hosted Checkout) — het Mollie-webhook-equivalent.
 * Worldline POST't een event met een X-GCS-Signature over de RAUWE body; die
 * verifiëren we met het webhook-secret. De order koppelen we via de
 * merchantReference (= ordernummer) → de opgeslagen hostedCheckoutId → GET-status
 * (bron van waarheid) → applyPaymentStatus + dezelfde afrond-functies als Mollie.
 * Idempotent (Worldline kan hetzelfde event vaker sturen). 200 = verwerkt.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-gcs-signature") || "";
  const keyId = req.headers.get("x-gcs-keyid") || "";
  if (!verifyWorldlineWebhook(raw, sig, keyId)) {
    return NextResponse.json({ ok: false, error: "ongeldige handtekening" }, { status: 401 });
  }

  let evt: { type?: string; payment?: { paymentOutput?: { references?: { merchantReference?: string } } } };
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }
  // Alleen initiële betaal-events. Post-betaling-events (refund/reversal/chargeback/dispute)
  // hier NIET verwerken: de her-opgehaalde status zou een reeds betaalde (mogelijk verzonden)
  // order clobberen naar failed + de cadeaubon onterecht terugstorten.
  const evtType = String(evt?.type || "");
  if (!evtType.startsWith("payment.")) return NextResponse.json({ ok: true });
  if (/refund|revers|chargeback|dispute/i.test(evtType)) return NextResponse.json({ ok: true });
  const merchantReference = String(evt?.payment?.paymentOutput?.references?.merchantReference || "");
  if (!merchantReference) return NextResponse.json({ ok: true });

  try {
    const ref = await paymentRefForOrderNumber(merchantReference);
    if (!ref) return NextResponse.json({ ok: true }); // onbekende order → niets te doen
    const status = await getWorldlineCheckoutStatus(ref);
    await applyPaymentStatus(ref, status.canonical);
    if (status.canonical === "paid") {
      await sendOrderConfirmationOnce(ref);
      await planAndPushFulfillmentOnce(ref);
    } else if (["canceled", "expired", "failed"].includes(status.canonical)) {
      await releaseOrderGiftcard(ref);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    // 500 → Worldline retryt later opnieuw.
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "webhook-fout" }, { status: 500 });
  }
}
