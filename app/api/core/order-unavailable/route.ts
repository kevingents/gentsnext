import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { reportUnfulfillable } from "@/lib/unfulfillable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/order-unavailable — een winkel meldt dat 'ie een toegewezen
 * weborder(-regel) niet kan leveren. Corrigeert de voorraad (fantoom eraf),
 * her-alloceert (die winkel uitgesloten) en logt de miss. Lukt her-alloceren
 * niet → set-context terug voor de make-whole.
 * Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN (zelfde als de kassa-core-calls).
 *
 * Body: { orderNumber, store, items:[{ sku, qty }], reason? }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { orderNumber?: unknown; store?: unknown; items?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const orderNumber = String(body?.orderNumber || "").trim();
  const store = String(body?.store || "").trim();
  const items = Array.isArray(body?.items)
    ? (body.items as { sku?: unknown; qty?: unknown }[]).map((i) => ({ sku: String(i?.sku || ""), qty: Number(i?.qty) || 1 }))
    : [];
  const res = await reportUnfulfillable(orderNumber, store, items, String(body?.reason || ""));
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
