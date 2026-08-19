import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getOrderByNumber } from "@/lib/orders";
import { storeShipments, setShipmentPicked, pickStatusForPlan } from "@/lib/split-fulfilment";
import { recordOrderPickMovement } from "@/lib/store-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/order-pick — een winkel meldt zijn deel van een (split-)weborder
 * gereed (gepickt), of maakt dat ongedaan. Onderdeel van de completeness-gate: pas
 * als álle winkeldelen gereed zijn geeft order-docs een verzendlabel vrij.
 *
 * Sinds de voorraad-fix boekt het gereedmelden óók de voorraad af: een −1-movement
 * (channel 'transfer', ref ORDERPICK-…) in het core-grootboek, en de web-reservering
 * slaat het gepickte deel voortaan over (zie recordOrderPickMovement en
 * webReservedAllLocations in lib/store-core.ts voor de dubbeltelling-keuze).
 * De response draagt movementRef + de regels zodat storegents dezelfde gebeurtenis
 * als transferbon 'naar' het webshop-filiaal (90) naar SRS kan spiegelen en de ref
 * bij acceptatie synced kan markeren.
 *
 * Body: { orderNumber, store, done? = true, pickedBy? }
 *   → { ok, pickStatus, movementRef, movementBooked, lines:[{sku,qty}] }.
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
    const moveLines = match.lines.map((l) => ({ sku: l.sku, qty: l.qty, name: l.title || null }));
    let movement: { ref: string | null; booked: boolean } = { ref: null, booked: false };
    /* Volgorde is bewust FAIL-CONSERVATIEF (liever tijdelijk te weinig beschikbaar
       dan oversell; een retry van de aanroeper herstelt het):
       - gereedmelden: eerst de −1-movement, dán de pick-rij. Faalt de pick-rij, dan
         telt de reservering nog mee náást de movement (−2) tot de retry slaagt.
       - ongedaan maken: eerst de pick-rij weg (reservering telt weer mee), dán de
         +1-compensatie. Faalt die, dan staat er tijdelijk −2 tot de retry. */
    if (done) {
      movement = await recordOrderPickMovement({ orderNumber, store: match.store, storeKey: match.key, lines: moveLines, done: true });
      await setShipmentPicked(orderNumber, match.store, pickedBy, true);
    } else {
      await setShipmentPicked(orderNumber, match.store, pickedBy, false);
      movement = await recordOrderPickMovement({ orderNumber, store: match.store, storeKey: match.key, lines: moveLines, done: false });
    }
    const pickStatus = await pickStatusForPlan(orderNumber, data.order.fulfillmentPlan);
    return NextResponse.json({
      ok: true,
      pickStatus,
      movementRef: movement.ref,
      movementBooked: movement.booked,
      lines: match.lines.map((l) => ({ sku: l.sku, qty: l.qty })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "fout" }, { status: 500 });
  }
}
