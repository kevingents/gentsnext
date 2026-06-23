import { NextResponse } from "next/server";
import { resolveReorder } from "@/lib/orders";
import { getSessionCustomer } from "@/lib/account";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/account/reorder — { orderNumber, token? } → huidige, leverbare regels
 * van die order (sku/prijs/voorraad nu). Viewer-beveiligd (eigenaar of access-token).
 */
export async function POST(req: Request) {
  let body: { orderNumber?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const orderNumber = String(body.orderNumber || "").trim();
  if (!orderNumber) return NextResponse.json({ ok: false, error: "orderNumber vereist." }, { status: 400 });

  const customer = await getSessionCustomer().catch(() => null);
  const res = await resolveReorder(orderNumber, {
    token: body.token ? String(body.token) : null,
    customerId: customer?.id ?? null,
  });
  if (!res) return NextResponse.json({ ok: false, error: "Geen toegang tot deze bestelling." }, { status: 403 });
  return NextResponse.json({ ok: true, addable: res.addable, unavailable: res.unavailable });
}
