import { NextResponse } from "next/server";
import { createOrder, attachMolliePayment, type CheckoutItem, type DeliveryMethod } from "@/lib/orders";
import { mollieConfigured, createMolliePayment } from "@/lib/mollie";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function bad(msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status: 400 });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Ongeldige aanvraag.");
  }

  const c = body?.contact ?? {};
  const items: CheckoutItem[] = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return bad("Je winkelwagen is leeg.");
  if (!c.email || !/.+@.+\..+/.test(c.email)) return bad("Vul een geldig e-mailadres in.");
  for (const f of ["firstName", "lastName", "street", "houseNumber", "postalCode", "city"]) {
    if (!String(c[f] || "").trim()) return bad("Vul alle adresvelden in.");
  }

  const deliveryMethod: DeliveryMethod = body?.deliveryMethod === "express" ? "express" : "standard";
  let order;
  try {
    order = await createOrder(c, items, deliveryMethod);
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Bestelling kon niet worden aangemaakt.");
  }

  // Niet geconfigureerd: order is bewaard, maar betalen kan nog niet.
  if (!mollieConfigured()) {
    return NextResponse.json({
      ok: true,
      configured: false,
      orderNumber: order.orderNumber,
      message: "Online afrekenen gaat binnenkort live. Je bestelling is nog niet verwerkt.",
    });
  }

  const origin = new URL(req.url).origin;
  try {
    const payment = await createMolliePayment({
      amountCents: order.totalCents,
      description: `GENTS bestelling ${order.orderNumber}`,
      redirectUrl: `${origin}/bestelling/${order.orderNumber}`,
      cancelUrl: `${origin}/afrekenen?geannuleerd=1`,
      webhookUrl: `${origin}/api/webhooks/mollie`,
      metadata: { orderNumber: order.orderNumber },
      idempotencyKey: `order-${order.id}`,
    });
    await attachMolliePayment(order.id, payment.id);
    if (!payment.checkoutUrl) return bad("Betaling kon niet worden gestart.");
    return NextResponse.json({ ok: true, configured: true, checkoutUrl: payment.checkoutUrl });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Betaling starten mislukte." },
      { status: 502 }
    );
  }
}
