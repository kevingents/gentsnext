import { NextResponse } from "next/server";
import { getReturnableOrder, createReturn, type ReturnMethod, type RefundType } from "@/lib/returns";
import { getSettings } from "@/lib/settings";
import { getStores } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Publieke retour-API. Gate = bestelnummer + e-mailadres (moeten matchen).
 *   POST { action:"lookup", orderNumber, email }
 *        → { ok, orderNumber, withinWindow, lines:[…], policy:{ windowDays, dhlReturnCostCents, freeOnCredit } }
 *   POST { action:"create", orderNumber, email, items:[{orderLineId,qty}], method, refundType, pickupStore?, reason? }
 *        → { ok, id, status, itemsCents, shippingCostCents, refundType, method, label, labelPending }
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const action = String(body.action || "");
  const orderNumber = String(body.orderNumber || "");
  const email = String(body.email || "");

  if (action === "lookup") {
    const res = await getReturnableOrder(orderNumber, email);
    if (!res.ok) return NextResponse.json(res, { status: 404 });
    const { returnConfig } = await getSettings();
    /* stores: voor flows die namens de klant een inleverwinkel kiezen (o.a. de
       helpdesk-agent) — de klant-flow krijgt de lijst al via de pagina-props. */
    return NextResponse.json({ ...res, policy: returnConfig, stores: getStores().map((s) => s.title) });
  }

  if (action === "create") {
    const items = Array.isArray(body.items)
      ? (body.items as { orderLineId: string; qty: number }[]).map((i) => ({ orderLineId: String(i.orderLineId), qty: Number(i.qty) }))
      : [];
    const res = await createReturn({
      orderNumber,
      email,
      items,
      method: (body.method === "store" ? "store" : "dhl") as ReturnMethod,
      refundType: (body.refundType === "credit" ? "credit" : "money") as RefundType,
      pickupStore: String(body.pickupStore || ""),
      reason: String(body.reason || ""),
    });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  }

  return NextResponse.json({ ok: false, error: "Onbekende actie." }, { status: 400 });
}
