import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { createPosCustomer, updatePosCustomer } from "@/lib/account";
import { listOrdersByCustomerCore } from "@/lib/orders";
import { listPosSalesByCustomerCore } from "@/lib/pos-sales-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/customer — gents.nl-klant vanaf de kassa/scanner. Auth: STORE_CORE_TOKEN.
 *
 *   create   { email, firstName?, lastName?, phone? }
 *     → { ok, customer:{ customerId, email, name, firstName, lastName, phone } }
 *   update   { customerId, firstName?, lastName?, email?, phone? }  (kassa-correctie)
 *     → { ok, customer:{…}, changed:[velden], previous:{…} }   — de aanroeper logt
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
        /* 0 als de klant al bestond. De kassa kan hiermee "welkom, +50 punten"
           tonen of op de bon zetten — zonder dat de kassa de regel hoeft te kennen. */
        welkomstpunten: c.welkomstpunten ?? 0,
      });
    }
    if (action === "update") {
      const r = await updatePosCustomer(String(b.customerId || ""), {
        firstName: b.firstName, lastName: b.lastName, email: b.email, phone: b.phone,
      });
      const c = r.updated;
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
      return NextResponse.json({
        ok: true,
        changed: r.changed,
        /* previous alléén van de gewijzigde velden: genoeg voor een audit-regel
           "van X naar Y", zonder het hele klantrecord terug te sturen. */
        previous: Object.fromEntries(r.changed.map((k) => [k, (r.previous as unknown as Record<string, unknown>)[k] ?? ""])),
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
