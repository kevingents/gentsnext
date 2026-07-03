import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import {
  createOrder,
  attachMolliePayment,
  finalizeGiftcardCoveredOrder,
  finalizeRegisterPaidOrder,
  type CheckoutItem,
  type DeliveryMethod,
} from "@/lib/orders";
import { mollieConfigured, createMolliePayment } from "@/lib/mollie";
import { recordPosOrder } from "@/lib/pos-orders-store";
import { getOrderByNumber } from "@/lib/orders";
import { sendConceptOrderMail } from "@/lib/email";
import { getSiteUrl } from "@/lib/site-url";

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
    paymentMode?: string;
    conceptMail?: boolean;
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
    order = await createOrder(c as never, items, deliveryMethod, "", "", pickupStore, storeName);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Bestelling mislukt." }, { status: 400 });
  }

  // Winkel-attributie vastleggen (best-effort; mag de bestelling niet blokkeren).
  await recordPosOrder({ orderNumber: order.orderNumber, storeName, staff: body?.staff }).catch(() => {});

  const origin = getSiteUrl(); // canonieke site-URL, niet de client-Host (webhook-kaping)
  const confirmUrl = `${origin}/bestelling/${order.orderNumber}?t=${order.accessToken}`;

  // Aan de kassa afgerekend (contant/pin) → geen betaallink; betaald markeren +
  // inplannen voor fulfilment uit het bron-filiaal. De omzet zit in de kassa-verkoop.
  if (body?.paymentMode === "register") {
    await finalizeRegisterPaidOrder(order.id);
    return NextResponse.json({ ok: true, orderNumber: order.orderNumber, paid: true, registerPaid: true, confirmUrl, totalCents: order.totalCents });
  }

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

    // Conceptbestelling: mail de klant z'n selectie + de afrond-link (best-effort).
    if (body?.conceptMail) {
      try {
        const full = await getOrderByNumber(order.orderNumber);
        await sendConceptOrderMail({
          email: String(c.email), firstName: String(c.firstName || ""), orderNumber: order.orderNumber,
          checkoutUrl: payment.checkoutUrl, store: storeName,
          items: (full?.lines || []).map((l) => ({ title: l.title, size: l.size, color: l.color, qty: l.quantity, unitPriceCents: l.unitPriceCents })),
        });
      } catch (e) {
        console.error("[pos/order] concept-mail mislukt:", (e as Error).message);
      }
      return NextResponse.json({ ok: true, orderNumber: order.orderNumber, checkoutUrl: payment.checkoutUrl, conceptMailed: true });
    }

    return NextResponse.json({ ok: true, orderNumber: order.orderNumber, checkoutUrl: payment.checkoutUrl });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Betaling starten mislukte." }, { status: 502 });
  }
}
