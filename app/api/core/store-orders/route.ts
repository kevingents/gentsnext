import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/store-orders — orders die een winkel moet afhandelen, uit ONZE
 * eigen site (gentsnext) — niet meer uit Shopify/SRS. Auth: STORE_CORE_TOKEN of
 * admin/STUDIO_API_TOKEN.
 *
 * Body: { location }  →
 *   { ok,
 *     afhaalorders: [...]    // click&collect, al betaald (pickup-checkout volgt → nu leeg)
 *     weborders:    [{ orderNumber, customer, status, statusLabel, totalCents, items:[{title,sku,qty}] }]
 *   }
 * weborders = betaalde web-orders waarvan het fulfilment-plan déze winkel als
 * leverlocatie heeft (ship-from-store), nog niet verzonden.
 */
type PlanShip = { store?: string; isWarehouse?: boolean; lines?: { sku?: string; qty?: number; title?: string }[] };

export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { location?: string };
  try {
    body = (await req.json()) as { location?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const location = String(body?.location || "").trim();
  if (!location) {
    return NextResponse.json({ ok: false, error: "location vereist." }, { status: 400 });
  }

  try {
    const db = getDb();
    const rows = await db.execute<{
      order_number: string; first_name: string; last_name: string; email: string;
      status: string; total_cents: number; delivery_method: string;
      fulfillment_plan: unknown; created_at: string;
    }>(sql`
      select order_number, first_name, last_name, email, status, total_cents,
             delivery_method, fulfillment_plan, created_at
      from orders
      where status in ('paid','ready_pickup')
        and fulfillment_status <> 'imported'
        and fulfillment_plan is not null
      order by created_at asc
      limit 200
    `);

    const weborders: unknown[] = [];
    for (const r of rows.rows) {
      const plan = r.fulfillment_plan as { shipments?: PlanShip[] } | null;
      const ship = (plan?.shipments || []).find(
        (s) => String(s.store || "").toLowerCase() === location.toLowerCase() && !s.isWarehouse,
      );
      if (!ship) continue;
      weborders.push({
        orderNumber: r.order_number,
        customer: `${r.first_name} ${r.last_name}`.trim() || r.email,
        status: r.status,
        statusLabel: r.status === "ready_pickup" ? "Klaar voor afhalen" : "Betaald",
        totalCents: r.total_cents,
        items: (ship.lines || []).map((l) => ({ title: l.title || l.sku || "", sku: l.sku || "", qty: Number(l.qty) || 1 })),
      });
    }

    // Click&collect-checkout bestaat nog niet op de nieuwe site → voorlopig leeg.
    const afhaalorders: unknown[] = [];

    return NextResponse.json({ ok: true, afhaalorders, weborders });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
