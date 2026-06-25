import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import {
  createOrder,
  attachMolliePayment,
  finalizeGiftcardCoveredOrder,
  type CheckoutItem,
  type DeliveryMethod,
} from "@/lib/orders";
import { mollieConfigured, createMolliePayment } from "@/lib/mollie";
import { recordPosOrder } from "@/lib/pos-orders-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/studio/pos/order — KASSA-bestelling (endless aisle): item niet in de
 * winkel → bestel uit een ander filiaal/magazijn → bezorgen bij klant. Maakt een
 * normale order (incl. fulfillment-allocatie) + Mollie-betaling en geeft de
 * BETAALLINK terug; de winkel-attributie wordt vastgelegd (omzet op het filiaal).
 * Auth: admin OF STUDIO_API_TOKEN (de portal-kassa proxyt met de token).
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: {
    contact?: Record<string, string>;
    items?: CheckoutItem[];
    storeName?: string;
    staff?: string;
    deliveryMethod?: string;
    pickupStore?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const c = body?.contact ?? {};
  const items: CheckoutItem[] = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return NextResponse.json({ ok: false, error: "Geen producten." }, { status: 400 });
  if (!c.email || !/.+@.+\..+/.test(c.email)) return NextResponse.json({ ok: false, error: "Geldig e-mailadres vereist." }, { status: 400 });
  for (const f of ["firstName", "lastName"]) {
    if (!String(c[f] || "").trim()) return NextResponse.json({ ok: false, error: "Vul de naam van de klant in." }, { status: 400 });
  }
  const storeName = String(body?.storeName || "").trim();
  if (!storeName) return NextResponse.json({ ok: false, error: "Filiaal ontbreekt." }, { status: 400 });

  // Afhalen in een (ander) filiaal of bezorgen bij de klant. Bij afhalen is er geen
  // adres nodig; bij bezorgen wél. createOrder reserveert bij afhalen in dat filiaal.
  const isPickup = body?.deliveryMethod === "pickup";
  const deliveryMethod: DeliveryMethod = isPickup ? "pickup" : body?.deliveryMethod === "express" ? "express" : "standard";
  const pickupStore = String(body?.pickupStore || "").trim();
  if (isPickup) {
    if (!pickupStore) return NextResponse.json({ ok: false, error: "Kies een afhaalfiliaal." }, { status: 400 });
  } else {
    for (const f of ["street", "houseNumber", "postalCode", "city"]) {
      if (!String(c[f] || "").trim()) return NextResponse.json({ ok: false, error: "Vul alle bezorgadres-velden in." }, { status: 400 });
    }
  }

  let order;
  try {
    order = await createOrder(c as never, items, deliveryMethod, "", "", pickupStore);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Bestelling mislukt." }, { status: 400 });
  }

  // Winkel-attributie vastleggen (best-effort; mag de bestelling niet blokkeren).
  await recordPosOrder({ orderNumber: order.orderNumber, storeName, staff: body?.staff }).catch(() => {});

  const origin = new URL(req.url).origin;
  const confirmUrl = `${origin}/bestelling/${order.orderNumber}?t=${order.accessToken}`;

  // Volledig met cadeaubon/voucher gedekt → geen betaling nodig.
  if (order.totalCents === 0) {
    await finalizeGiftcardCoveredOrder(order.id);
    return NextResponse.json({ ok: true, orderNumber: order.orderNumber, paid: true, checkoutUrl: confirmUrl });
  }
  if (!mollieConfigured()) {
    return NextResponse.json({ ok: true, orderNumber: order.orderNumber, configured: false, message: "Mollie niet geconfigureerd." });
  }

  try {
    const payment = await createMolliePayment({
      amountCents: order.totalCents,
      description: `GENTS winkelbestelling ${order.orderNumber} (${storeName})`,
      redirectUrl: confirmUrl,
      cancelUrl: `${origin}/afrekenen?geannuleerd=1`,
      webhookUrl: `${origin}/api/webhooks/mollie`,
      metadata: { orderNumber: order.orderNumber },
      idempotencyKey: `order-${order.id}`,
    });
    await attachMolliePayment(order.id, payment.id);
    if (!payment.checkoutUrl) return NextResponse.json({ ok: false, error: "Betaling kon niet worden gestart." }, { status: 502 });
    return NextResponse.json({ ok: true, orderNumber: order.orderNumber, checkoutUrl: payment.checkoutUrl });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Betaling starten mislukte." }, { status: 502 });
  }
}
