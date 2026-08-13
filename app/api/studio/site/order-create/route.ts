import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { maakHandmatigeOrder, type HandmatigeOrderInvoer } from "@/lib/order-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/studio/site/order-create — handmatig een bestelling aanmaken voor
 * een klant (telefonisch, per mail, of een nabestelling na een klacht) mét
 * betaallink.
 *
 * Body: { contact, items:[{sku,qty}], deliveryMethod, pickupStore?, voucherCode?,
 *         soldByStore?, betaalwijze: "link"|"handmatig", mail?, notitie?, actor? }
 *
 * De bestelling loopt door dezelfde createOrder als de webshop — prijzen uit de
 * database, voorraad atomair geclaimd. Zie lib/order-admin voor het waarom.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: HandmatigeOrderInvoer & { actor?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const items = Array.isArray(body?.items)
    ? body.items
        .map((i) => ({ sku: String((i as { sku?: unknown })?.sku || "").trim(), qty: Math.max(1, Math.min(20, Math.floor(Number((i as { qty?: unknown })?.qty) || 1))) }))
        .filter((i) => i.sku)
    : [];

  try {
    const res = await maakHandmatigeOrder(
      {
        contact: body?.contact ?? {},
        items,
        deliveryMethod: String(body?.deliveryMethod || "standard"),
        pickupStore: String(body?.pickupStore || ""),
        voucherCode: String(body?.voucherCode || ""),
        soldByStore: String(body?.soldByStore || ""),
        betaalwijze: body?.betaalwijze === "handmatig" ? "handmatig" : "link",
        mail: body?.mail === true,
        notitie: String(body?.notitie || ""),
      },
      { actor: String(body?.actor || "").trim() },
    );
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
