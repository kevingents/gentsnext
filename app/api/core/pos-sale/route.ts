import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import {
  recordPosSaleCore, listPosSalesCore, listUnpostedPosSalesCore, getPosSaleCore,
  findSaleByClientRefCore, cancelPosSaleCore, markPosSaleSrsPostedCore, listPosSalesByRangeCore,
  listPosSalesByCustomerCore,
} from "@/lib/pos-sales-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/pos-sale — kassa-verkopen in de Neon-core (vervangt de storegents-
 * blob admin/pos-sales.json). Action-based. Auth: STORE_CORE_TOKEN.
 *
 *   record          { sale }                 → { ok, sale, deduped? }  (idempotent op client_ref)
 *   list            { store, limit? }         → { ok, sales }
 *   list-unposted   { store, limit? }         → { ok, sales }
 *   get             { id }                     → { ok, sale }
 *   find-by-ref     { clientRef }              → { ok, sale }
 *   cancel          { id, actor? }             → { ok, sale }
 *   mark-srs-posted { id, opts? }              → { ok, sale }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; sale?: Record<string, unknown>; store?: string; limit?: number; id?: string; clientRef?: string; actor?: { name?: string }; opts?: Record<string, string>; from?: string; to?: string; customerId?: string; email?: string };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    switch (action) {
      case "record":
        return NextResponse.json(await recordPosSaleCore(b.sale || {}));
      case "list":
        return NextResponse.json({ ok: true, sales: await listPosSalesCore(b.store || "", b.limit) });
      case "list-by-range":
        return NextResponse.json({ ok: true, sales: await listPosSalesByRangeCore(b.store || "", b.from || "", b.to || "") });
      case "by-customer":
        return NextResponse.json({ ok: true, sales: await listPosSalesByCustomerCore({ customerId: b.customerId, email: b.email, limit: b.limit }) });
      case "list-unposted":
        return NextResponse.json({ ok: true, sales: await listUnpostedPosSalesCore(b.store || "", b.limit) });
      case "get": {
        const s = await getPosSaleCore(String(b.id || ""));
        return NextResponse.json({ ok: !!s, sale: s });
      }
      case "find-by-ref": {
        const s = await findSaleByClientRefCore(String(b.clientRef || ""));
        return NextResponse.json({ ok: !!s, sale: s });
      }
      case "cancel": {
        const s = await cancelPosSaleCore(String(b.id || ""), b.actor || {});
        return NextResponse.json({ ok: !!s, sale: s });
      }
      case "mark-srs-posted": {
        const s = await markPosSaleSrsPostedCore(String(b.id || ""), b.opts || {});
        return NextResponse.json({ ok: !!s, sale: s });
      }
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
