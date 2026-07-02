import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getOrderByNumber } from "@/lib/orders";
import { storeShipments, setShipmentPicked, pickStatusForPlan } from "@/lib/split-fulfilment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/order-pick — een winkel meldt zijn deel van een (split-)weborder
 * gereed (gepickt), of maakt dat ongedaan. Onderdeel van de completeness-gate: pas
 * als álle winkeldelen gereed zijn geeft order-docs een verzendlabel vrij.
 *
 * Body: { orderNumber, store, done? = true, pickedBy? } → { ok, pickStatus }.
 * Auth: STORE_CORE_TOKEN (coreAuth).
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { orderNumber?: string; store?: string; done?: boolean; pickedBy?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const orderNumber = String(body?.orderNumber || "").trim();
  const store = String(body?.store || "").trim();
  const done = body?.done !== false; // default: gereed melden
  const pickedBy = String(body?.pickedBy || "").trim().slice(0, 80);
  if (!orderNumber || !store) {
    return NextResponse.json({ ok: false, error: "orderNumber en store vereist." }, { status: 400 });
  }

  const data = await getOrderByNumber(orderNumber);
  if (!data) return NextResponse.json({ ok: false, error: "Order niet gevonden." }, { status: 404 });

  // Alleen een winkel die daadwerkelijk een deel van deze order levert mag melden.
  const parts = storeShipments(data.order.fulfillmentPlan);
  const match = parts.find((p) => p.key === store.toLowerCase());
  if (!match) {
    return NextResponse.json({ ok: false, error: "Deze winkel levert geen deel van deze order." }, { status: 400 });
  }

  try {
    await setShipmentPicked(orderNumber, match.store, pickedBy, done);
    const pickStatus = await pickStatusForPlan(orderNumber, data.order.fulfillmentPlan);
    return NextResponse.json({ ok: true, pickStatus });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "fout" }, { status: 500 });
  }
}
