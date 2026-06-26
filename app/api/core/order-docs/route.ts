import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getOrderByNumber } from "@/lib/orders";
import { renderPackingSlip } from "@/lib/packing-slip";
import { dhlConfigured, createShipmentLabel } from "@/lib/dhl";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/order-docs — pakbon + (DHL-)verzendlabel voor een ship-from-store
 * weborder, zodat de winkel ze meteen kan uitdraaien. Auth: STORE_CORE_TOKEN.
 *
 * Body: { orderNumber, store? } →
 *   { ok, packingSlipHtml, label: { configured, ok?, base64?, url?, tracking?, error? } }
 * De pakbon werkt altijd; het label vereist de DHL-keys (anders configured:false).
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { orderNumber?: string; store?: string };
  try {
    body = (await req.json()) as { orderNumber?: string; store?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const orderNumber = String(body?.orderNumber || "").trim();
  if (!orderNumber) return NextResponse.json({ ok: false, error: "orderNumber vereist." }, { status: 400 });

  const data = await getOrderByNumber(orderNumber);
  if (!data) return NextResponse.json({ ok: false, error: "Order niet gevonden." }, { status: 404 });

  const { order, lines } = data;
  const packingSlipHtml = renderPackingSlip(order, lines, { store: body?.store });

  let label: { configured: boolean; ok?: boolean; base64?: string; url?: string; tracking?: string; error?: string } = { configured: false };
  if (dhlConfigured()) {
    const l = await createShipmentLabel(orderNumber, {
      name: [order.firstName, order.lastName].filter(Boolean).join(" ").trim(),
      street: order.street || "",
      number: order.houseNumber || "",
      postalCode: order.postalCode || "",
      city: order.city || "",
      country: order.country || "NL",
      email: order.email || undefined,
    });
    label = { configured: true, ok: l.ok, base64: l.labelBase64, url: l.labelUrl, tracking: l.tracking, error: l.error };
  }

  return NextResponse.json({ ok: true, packingSlipHtml, label });
}
