import { NextResponse } from "next/server";
import { getOrderForViewer } from "@/lib/orders";
import { getSessionCustomer } from "@/lib/account";

export const dynamic = "force-dynamic";

/**
 * Publieke (token-beveiligde) order-status — voor de auto-poll op de
 * bedanktpagina, zodat 'in afwachting' vanzelf naar 'bevestigd' springt zodra
 * de Mollie-webhook binnen is. Zelfde IDOR-bescherming als de orderpagina.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderNumber = url.searchParams.get("orderNumber") || "";
  const t = url.searchParams.get("t");
  const customer = await getSessionCustomer();
  const data = await getOrderForViewer(orderNumber, { token: t, customerId: customer?.id });
  if (!data) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, status: data.order.status });
}
