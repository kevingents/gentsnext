import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { getOrderByNumber } from "@/lib/orders";
import { allocateOrder } from "@/lib/fulfillment";
import { previewWeborders, srsCredentialsPresent } from "@/lib/srs";

export const dynamic = "force-dynamic";

/**
 * Admin: toont de SRS-weborder-XML die voor een bestaand order ZOU worden
 * verstuurd — zonder iets naar SRS te pushen. Voor validatie vóór go-live.
 */
export async function GET(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer?.isAdmin) return NextResponse.json({ ok: false, error: "geen toegang" }, { status: 403 });

  const orderNumber = (new URL(req.url).searchParams.get("order") || "").trim();
  if (!orderNumber) return NextResponse.json({ ok: false, error: "Geef een ordernummer op." }, { status: 400 });

  const data = await getOrderByNumber(orderNumber);
  if (!data) return NextResponse.json({ ok: false, error: "Order niet gevonden." }, { status: 404 });

  const { order, lines } = data;
  const plan = await allocateOrder(
    lines.map((l) => ({ sku: l.sku, qty: l.quantity, title: l.title, groupId: l.groupId ?? undefined })),
    { country: order.country, postalCode: order.postalCode }
  );
  const weborders = previewWeborders(
    order,
    plan,
    lines.map((l) => ({ sku: l.sku, quantity: l.quantity, title: l.title, unitPriceCents: l.unitPriceCents }))
  );

  return NextResponse.json({
    ok: true,
    orderNumber,
    fullyAllocated: plan.fullyAllocated,
    splitCount: plan.splitCount,
    credsPresent: srsCredentialsPresent(),
    pushEnabled: process.env.SRS_PUSH_ENABLED === "true",
    weborders,
  });
}
