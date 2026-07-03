import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getOrderByNumber, updateOrderStatus } from "@/lib/orders";
import { pickStatusForPlan, canReleaseLabel } from "@/lib/split-fulfilment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/order-status — zet de status van een (eigen) order vanuit de
 * kassa (bv. afhaalorder "Markeer opgehaald" → delivered). Vervangt de oude
 * Shopify-fulfilment. Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN.
 *
 * Body: { orderNumber, status }  → { ok }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { orderNumber?: string; status?: string };
  try {
    body = (await req.json()) as { orderNumber?: string; status?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const orderNumber = String(body?.orderNumber || "").trim();
  const status = String(body?.status || "").trim();
  if (!orderNumber || !status) {
    return NextResponse.json({ ok: false, error: "orderNumber + status vereist." }, { status: 400 });
  }
  try {
    const data = await getOrderByNumber(orderNumber);
    if (!data) {
      return NextResponse.json({ ok: false, error: "Order niet gevonden." }, { status: 404 });
    }
    // Completeness-gate (backstop): een multi-winkel-split mag pas op 'shipped' als
    // álle winkeldelen gereed gemeld zijn (/api/core/order-pick). Anders zou één winkel
    // de hele order op verzonden zetten → valse verzendmail + het deel van de andere
    // winkel verdwijnt uit z'n lijst. Beschermt ongeacht de kassa-UI.
    if (status === "shipped") {
      const pick = await pickStatusForPlan(orderNumber, data.order.fulfillmentPlan);
      if (!canReleaseLabel(pick)) {
        return NextResponse.json(
          { ok: false, error: `Nog niet alle winkeldelen gereed (${pick.pickedCount}/${pick.storeParts}). Meld elk deel gereed voordat je verzendt.`, pickStatus: pick },
          { status: 409 },
        );
      }
    }
    const ok = await updateOrderStatus(data.order.id, status);
    if (!ok) {
      return NextResponse.json({ ok: false, error: `Status "${status}" niet toegestaan.` }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
