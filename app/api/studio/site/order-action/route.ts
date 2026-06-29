import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getOrderByNumber, updateOrderStatus } from "@/lib/orders";
import { reportUnfulfillable, resolveUnfulfillable } from "@/lib/unfulfillable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/studio/site/order-action — order-acties voor het portal-"Nieuwe
 * site"-CMS. Body: { orderNumber, action: "status" | "unavailable" | "resolve-unavailable", status? }.
 *
 *  - action "status": zet de order-status (en stuurt de klant een update via
 *    updateOrderStatus → notifyOrderStatus).
 *
 * (SRS-push is afgeschaft — SRS = alleen WMS; fulfilment loopt via het eigen
 *  Neon-plan, niet meer naar SRS.)
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  let body: { orderNumber?: unknown; action?: unknown; status?: unknown; store?: unknown; items?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const orderNumber = String(body?.orderNumber || "").trim();
  const action = String(body?.action || "").trim();
  if (!orderNumber) {
    return NextResponse.json({ ok: false, error: "Geen ordernummer." }, { status: 400 });
  }

  try {
    const data = await getOrderByNumber(orderNumber);
    if (!data) {
      return NextResponse.json({ ok: false, error: "Order niet gevonden." }, { status: 404 });
    }

    if (action === "status") {
      const status = String(body?.status || "").trim();
      if (!status) {
        return NextResponse.json({ ok: false, error: "Geen status opgegeven." }, { status: 400 });
      }
      const ok = await updateOrderStatus(data.order.id, status);
      if (!ok) {
        return NextResponse.json({ ok: false, error: `Status "${status}" niet toegestaan.` }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "unavailable") {
      const store = String(body?.store || "").trim();
      const items = Array.isArray(body?.items)
        ? (body.items as { sku?: unknown; qty?: unknown }[]).map((i) => ({ sku: String(i?.sku || ""), qty: Number(i?.qty) || 1 }))
        : [];
      const res = await reportUnfulfillable(orderNumber, store, items, String(body?.reason || ""));
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    if (action === "resolve-unavailable") {
      const mode = String(body?.status || "").trim() === "return" ? "return" : "cancel";
      const res = await resolveUnfulfillable(orderNumber, mode);
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    return NextResponse.json({ ok: false, error: "Onbekende actie." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
