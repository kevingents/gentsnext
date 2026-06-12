import { NextResponse } from "next/server";
import { getMolliePayment, mollieConfigured } from "@/lib/mollie";
import { applyPaymentStatus } from "@/lib/orders";

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
    await applyPaymentStatus(payment.id, payment.status);
    // TODO (na go-live): op 'paid' de order naar SRS si_weborder pushen
    // (zelfde patroon als de Bol-pipeline) en voorraad afboeken.
    return NextResponse.json({ ok: true });
  } catch (e) {
    // 500 → Mollie retryt later opnieuw (tot 10x over ~26u).
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "webhook-fout" },
      { status: 500 }
    );
  }
}
