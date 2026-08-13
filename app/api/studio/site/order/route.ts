import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getOrderByNumber } from "@/lib/orders";
import { betaalOverzicht, logboekVoorOrder } from "@/lib/order-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * GET /api/studio/site/order?order=G2A3B4C — orderdetail van de nieuwe site:
 * order + regels + het volledige allocatieplan (order-route) zit in
 * order.fulfillmentPlan.
 *
 * Daarbovenop, voor het back-office:
 *  - `betaling`: momentopname bij Mollie (status, methode, al terugbetaald) plus
 *    wat er nú kan — hoeveel er terug mag en of een nieuwe betaallink is
 *    toegestaan. Faalt zacht: ligt Mollie plat, dan blijft de rest van de
 *    pagina gewoon staan en blijven de geld-knoppen uit.
 *  - `logboek`: wie welke handmatige actie deed (audit-spoor).
 *
 * Auth: admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const orderNumber = (new URL(req.url).searchParams.get("order") || "").trim();
  if (!orderNumber) return NextResponse.json({ ok: false, error: "Geen ordernummer." }, { status: 400 });
  try {
    const data = await getOrderByNumber(orderNumber);
    if (!data?.order) return NextResponse.json({ ok: false, error: "Order niet gevonden." }, { status: 404 });
    // Naast elkaar: de Mollie-call is de traagste van de twee en mag de
    // logboek-query niet ophouden.
    const [betaling, logboek] = await Promise.all([
      betaalOverzicht(orderNumber).catch(() => null),
      logboekVoorOrder(orderNumber).catch(() => []),
    ]);
    return NextResponse.json({ ok: true, order: data.order, lines: data.lines, betaling, logboek });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
