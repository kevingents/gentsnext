import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { updateOrderStatus } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** Admin: order-status wijzigen + klant informeren. */
export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer?.isAdmin) return NextResponse.json({ ok: false, error: "geen beheerrechten" }, { status: 403 });
  let body: { orderId?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }
  const ok = await updateOrderStatus(String(body.orderId || ""), String(body.status || ""));
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}
