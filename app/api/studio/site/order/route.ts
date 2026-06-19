import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getOrderByNumber } from "@/lib/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/order?order=G2A3B4C — orderdetail van de nieuwe site:
 * order + regels + het volledige allocatieplan (order-route) zit in
 * order.fulfillmentPlan. Auth: admin OF STUDIO_API_TOKEN.
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
    return NextResponse.json({ ok: true, order: data.order, lines: data.lines });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
