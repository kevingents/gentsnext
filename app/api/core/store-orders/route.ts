import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { sql, inArray } from "drizzle-orm";
import { orderLines } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { computePickDeadline, branchIdForStoreName } from "@/lib/fulfillment-config";

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
      id: string; order_number: string; first_name: string; last_name: string; email: string;
      status: string; total_cents: number; delivery_method: string;
      fulfillment_plan: unknown; created_at: string;
    }>(sql`
      select id, order_number, first_name, last_name, email, status, total_cents,
             delivery_method, fulfillment_plan, created_at
      from orders
      where status in ('paid','ready_pickup')
        and fulfillment_status <> 'imported'
        and fulfillment_plan is not null
      order by created_at asc
      limit 200
    `);

    // Pass 1: filter op de orders die DEZE winkel raakt (afhalen of ship-from-store).
    const locLower = location.toLowerCase();
    type Matched = { r: (typeof rows.rows)[number]; ship: PlanShip; parts: number };
    const matched: Matched[] = [];
    for (const r of rows.rows) {
      const plan = r.fulfillment_plan as { shipments?: PlanShip[] } | null;
      const ship = (plan?.shipments || []).find((s) => String(s.store || "").toLowerCase() === locLower);
      if (!ship) continue;
      if (r.delivery_method !== "pickup" && ship.isWarehouse) continue; // magazijn-deel niet voor de winkel
      matched.push({ r, ship, parts: (plan?.shipments || []).length });
    }

    // Verrijking: maat/kleur per regel (order_lines), productfoto (per sku),
    // "vaste klant" (≥2 betaalde orders), en de pick-deadline (cutoff).
    const orderIds = [...new Set(matched.map((m) => m.r.id))];
    const skus = [...new Set(matched.flatMap((m) => (m.ship.lines || []).map((l) => l.sku || "").filter(Boolean)))];
    const emails = [...new Set(matched.map((m) => (m.r.email || "").toLowerCase()).filter(Boolean))];

    const lineMeta = new Map<string, { size: string; color: string }>(); // key: orderId|sku
    if (orderIds.length) {
      const ol = await db.select({ orderId: orderLines.orderId, sku: orderLines.sku, size: orderLines.size, color: orderLines.color })
        .from(orderLines).where(inArray(orderLines.orderId, orderIds));
      for (const l of ol) lineMeta.set(`${l.orderId}|${l.sku}`, { size: l.size || "", color: l.color || "" });
    }

    const imgBySku = new Map<string, string>();
    if (skus.length) {
      const imgs = await db.execute<{ sku: string; img: string | null }>(sql`
        select v.sku,
               coalesce((select pi.url from product_images pi where pi.product_id = v.product_id order by pi.position asc limit 1), nullif(v.image_url, '')) img
        from product_variants v
        where v.sku in (${sql.join(skus.map((s) => sql`${s}`), sql`, `)})`);
      for (const row of imgs.rows) if (row.img) imgBySku.set(row.sku, row.img);
    }

    const repeatEmails = new Set<string>();
    if (emails.length) {
      const rep = await db.execute<{ email: string; c: number }>(sql`
        select lower(email) email, count(*)::int c from orders
        where lower(email) in (${sql.join(emails.map((e) => sql`${e}`), sql`, `)})
          and status in ('paid','shipped','ready_pickup','delivered','fulfilled')
        group by lower(email)`);
      for (const row of rep.rows) if (Number(row.c) >= 2) repeatEmails.add(row.email);
    }

    const settings = await getSettings();
    const branchId = branchIdForStoreName(location);
    const now = new Date();

    // Pass 2: payload bouwen met verrijking.
    const afhaalorders: unknown[] = [];
    const weborders: unknown[] = [];
    for (const { r, ship, parts } of matched) {
      const customer = `${r.first_name} ${r.last_name}`.trim() || r.email;
      const isRepeat = repeatEmails.has((r.email || "").toLowerCase());
      const dl = computePickDeadline(new Date(r.created_at), branchId, settings, now);
      const items = (ship.lines || []).map((l) => {
        const sku = l.sku || "";
        const meta = lineMeta.get(`${r.id}|${sku}`);
        return { title: l.title || sku, sku, qty: Number(l.qty) || 1, size: meta?.size || "", color: meta?.color || "", imageUrl: imgBySku.get(sku) || "" };
      });

      if (r.delivery_method === "pickup") {
        afhaalorders.push({
          id: r.order_number, name: r.order_number, customer, email: r.email, phone: "",
          items: items.map((it) => ({ title: it.title, sku: it.sku, quantity: it.qty, size: it.size, color: it.color, imageUrl: it.imageUrl })),
          totalPrice: ((Number(r.total_cents) || 0) / 100).toFixed(2), currency: "EUR",
          pickupStatusLabel: r.status === "ready_pickup" ? "Klaar om af te halen" : "Betaald",
          financialStatus: "paid",
          isRepeatCustomer: isRepeat, pickByLabel: dl.pickByLabel, overdue: dl.overdue, soon: dl.soon,
        });
      } else {
        weborders.push({
          orderNumber: r.order_number, customer, status: r.status,
          statusLabel: r.status === "ready_pickup" ? "Klaar voor afhalen" : "Betaald",
          totalCents: r.total_cents, items, parts,
          isRepeatCustomer: isRepeat, pickByLabel: dl.pickByLabel, overdue: dl.overdue, soon: dl.soon,
        });
      }
    }

    return NextResponse.json({ ok: true, afhaalorders, weborders });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
