import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { updateOrderStatus } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** Recht "operatie": order-status wijzigen + klant informeren. */
export async function POST(req: Request) {
  if (!(await requirePermission("operatie"))) {
    return NextResponse.json({ ok: false, error: "Geen toegang: hiervoor heb je het werkgebied Operatie nodig." }, { status: 403 });
  }
  let body: { orderId?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }
  const ok = await updateOrderStatus(String(body.orderId || ""), String(body.status || ""));
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}
