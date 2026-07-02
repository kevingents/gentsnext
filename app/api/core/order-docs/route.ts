import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getOrderByNumber } from "@/lib/orders";
import { renderPackingSlip } from "@/lib/packing-slip";
import { dhlConfigured, createShipmentLabel } from "@/lib/dhl";
import { pickStatusForPlan, canReleaseLabel, type PickStatus } from "@/lib/split-fulfilment";

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
  // De pakbon werkt altijd (die heb je nodig om te picken). Het verzendlabel is
  // gate-gebonden: bij een multi-winkel-split pas een label als álle winkeldelen
  // gereed zijn (anders half-verscheepte order).
  const packingSlipHtml = renderPackingSlip(order, lines, { store: body?.store });
  const pickStatus = await pickStatusForPlan(orderNumber, order.fulfillmentPlan);
  const allowed = canReleaseLabel(pickStatus);

  let label: {
    configured: boolean;
    ok?: boolean;
    base64?: string;
    url?: string;
    tracking?: string;
    error?: string;
    gated?: boolean;
    pickStatus?: PickStatus;
  } = { configured: false };

  if (!allowed) {
    // Gate dicht: geen label tot alle delen gereed. Pakbon volgt wél zodat de winkel
    // z'n deel kan picken en daarna gereed kan melden (/api/core/order-pick).
    label = {
      configured: dhlConfigured(),
      gated: true,
      error: `Nog niet alle winkeldelen gereed (${pickStatus.pickedCount}/${pickStatus.storeParts}). Meld je deel gereed; het label komt vrij zodra alle winkels klaar zijn.`,
      pickStatus,
    };
  } else if (dhlConfigured()) {
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

  return NextResponse.json({ ok: true, packingSlipHtml, label, pickStatus });
}
