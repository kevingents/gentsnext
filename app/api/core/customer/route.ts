import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { createPosCustomer } from "@/lib/account";
import { listOrdersByCustomerCore } from "@/lib/orders";
import { listPosSalesByCustomerCore } from "@/lib/pos-sales-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/customer — gents.nl-klant vanaf de kassa/scanner. Auth: STORE_CORE_TOKEN.
 *
 *   create   { email, firstName?, lastName?, phone? }
 *     → { ok, customer:{ customerId, email, name, firstName, lastName, phone } }
 *   overview { customerId?, email?, limit? }   (omnichannel-historie voor het klant-paneel)
 *     → { ok, orders:[…online…], sales:[…kassa-bonnen…] }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; email?: string; firstName?: string; lastName?: string; phone?: string; customerId?: string; limit?: number };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    if (action === "create") {
      const c = await createPosCustomer({ email: b.email || "", firstName: b.firstName, lastName: b.lastName, phone: b.phone });
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
      return NextResponse.json({
        ok: true,
        customer: { customerId: c.id, email: c.email, name, firstName: c.firstName || "", lastName: c.lastName || "", phone: c.phone || "" },
      });
    }
    if (action === "overview") {
      const [orders, sales] = await Promise.all([
        listOrdersByCustomerCore({ customerId: b.customerId, email: b.email, limit: b.limit }),
        listPosSalesByCustomerCore({ customerId: b.customerId, email: b.email, limit: b.limit }),
      ]);
      return NextResponse.json({ ok: true, orders, sales });
    }
    return NextResponse.json({ ok: false, error: "Onbekende actie." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
