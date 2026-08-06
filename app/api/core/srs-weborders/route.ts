import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { sql, inArray } from "drizzle-orm";
import { orderLines } from "@/db/schema";
import { storeShipments } from "@/lib/split-fulfilment";
import { availableInStore } from "@/lib/store-core";
import { WAREHOUSE_BRANCHES } from "@/lib/fulfillment-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Core-API voor de SRS-weborder-koppeling (magazijn blijft tijdens de overgang in
 * SRS picken, de winkels op de nieuwe kassa).
 *
 *   GET  /api/core/srs-weborders?since=ISO&limit=25  → orders die naar SRS moeten
 *   POST /api/core/srs-weborders { orderNumber, srsOrderId? }  → markeer gepusht
 *
 * We leveren ALLEEN het magazijn-deel van een order uit: winkel-delen lopen via de
 * print-inbox/pick-flow van de kassa. Het SRS-ordernummer is ons eigen ordernummer
 * (past binnen de 15 tekens van SRS), zodat de statusterugkoppeling zonder
 * mapping-tabel kan matchen.
 *
 * `since` is verplicht en beschermt tegen een stormloop: bij het aanzetten van de
 * koppeling mag de bestaande achterstand niet alsnog het magazijn in rollen.
 * Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN (coreAuth).
 */

type PlanShip = {
  store?: string;
  isWarehouse?: boolean;
  units?: number;
  lines?: { sku?: string; qty?: number; title?: string }[];
};

const MAX_LIMIT = 100;

export async function GET(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const url = new URL(req.url);
  const sinceRaw = String(url.searchParams.get("since") || "").trim();
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (!since || Number.isNaN(since.getTime())) {
    return NextResponse.json(
      { ok: false, error: "since (ISO-datum) vereist — beschermt tegen het pushen van de hele achterstand." },
      { status: 400 },
    );
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit")) || 25));

  try {
    const db = getDb();
    const res = await db.execute<{
      id: string;
      order_number: string;
      created_at: string;
      email: string;
      first_name: string;
      last_name: string;
      phone: string;
      street: string;
      house_number: string;
      postal_code: string;
      city: string;
      country: string;
      company_name: string;
      locale: string;
      currency: string;
      shipping_cents: number;
      total_cents: number;
      delivery_method: string;
      fulfillment_plan: unknown;
    }>(sql`
      select id, order_number, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') created_at,
             email, first_name, last_name, phone, street, house_number, postal_code, city,
             country, company_name, locale, currency, shipping_cents, total_cents,
             delivery_method, fulfillment_plan
      from orders
      where status = 'paid'
        and srs_pushed_at is null
        and delivery_method <> 'pickup'
        and fulfillment_plan is not null
        /* 'planned' sluit twee valkuilen uit: geïmporteerde Shopify-historie
           (fulfillment_status 'imported', 35k orders) en orders die op 'review'
           staan omdat er een tekort was. Alleen een schoon, volledig plan mag
           het magazijn in. */
        and fulfillment_status = 'planned'
        /* Op BETAALmoment filteren, niet op besteldatum: een order die lang open
           stond en nu pas betaald wordt hoort er wél bij. */
        and coalesce(paid_at, created_at) >= ${since.toISOString()}
      order by coalesce(paid_at, created_at) asc
      limit ${limit}
    `);

    // Alleen orders met een magazijn-deel; winkel-only-orders lopen via de kassa.
    type Matched = { r: (typeof res.rows)[number]; ship: PlanShip; storeParts: number };
    const matched: Matched[] = [];
    for (const r of res.rows) {
      const ships = (r.fulfillment_plan as { shipments?: PlanShip[] } | null)?.shipments || [];
      const ship = ships.find((s) => s.isWarehouse);
      if (!ship || !(ship.lines || []).length) continue;
      matched.push({ r, ship, storeParts: storeShipments(r.fulfillment_plan).length });
    }

    // Regel-detail (prijs per stuk, maat/kleur) uit order_lines — het plan bevat
    // alleen sku/qty/title.
    const orderIds = [...new Set(matched.map((m) => m.r.id))];
    const lineMeta = new Map<string, { unitPriceCents: number; size: string; color: string; title: string }>();
    if (orderIds.length) {
      const ol = await db
        .select({
          orderId: orderLines.orderId,
          sku: orderLines.sku,
          title: orderLines.title,
          size: orderLines.size,
          color: orderLines.color,
          unitPriceCents: orderLines.unitPriceCents,
        })
        .from(orderLines)
        .where(inArray(orderLines.orderId, orderIds));
      for (const l of ol) {
        lineMeta.set(`${l.orderId}|${l.sku}`, {
          unitPriceCents: Number(l.unitPriceCents) || 0,
          size: l.size || "",
          color: l.color || "",
          title: l.title || "",
        });
      }
    }

    /* Voorraadcheck vlak vóór het pushen. Het allocatieplan is gemaakt op de
       SRS-baseline, die achterloopt op kassaverkopen en andere web-orders. Zo kan
       een tweede order op hetzelfde laatste stuk worden toegewezen — en een push
       maakt die dubbele toewijzing hard in SRS (dubbele afboeking; één klant
       hoort dagen later dat het toch niet kan).
       LET OP bij het lezen van availableInStore: die trekt de web-reserveringen
       van álle lopende orders af, dus óók die van de order die we nu bekijken.
       Een gezonde order komt daardoor op 0 uit, niet op zijn eigen aantal. Een
       NEGATIEVE waarde is het echte alarm: er is meer gereserveerd dan er ligt. */
    const magazijnLocatie = matched.find((m) => m.ship.store)?.ship.store || WAREHOUSE_BRANCHES[0];
    const magazijnSkus = [...new Set(matched.flatMap((m) => (m.ship.lines || []).map((l) => l.sku || "").filter(Boolean)))];
    const beschikbaar = magazijnSkus.length
      ? await availableInStore(magazijnLocatie, magazijnSkus).catch(() => new Map<string, number>())
      : new Map<string, number>();

    const orders = matched.map(({ r, ship, storeParts }) => {
      const lines = (ship.lines || [])
        .filter((l) => l.sku)
        .map((l) => {
          const meta = lineMeta.get(`${r.id}|${l.sku}`);
          return {
            sku: String(l.sku),
            title: meta?.title || l.title || String(l.sku),
            size: meta?.size || "",
            color: meta?.color || "",
            qty: Math.max(1, Number(l.qty) || 1),
            unitPriceCents: meta?.unitPriceCents ?? 0,
          };
        });
      const linesCents = lines.reduce((n, l) => n + l.unitPriceCents * l.qty, 0);
      const tekorten: { sku: string; nodig: number; tekort: number }[] = [];
      for (const l of lines) {
        const k = l.sku.toLowerCase();
        const rest = Number(beschikbaar.get(k) ?? beschikbaar.get(l.sku) ?? 0);
        if (rest < 0) tekorten.push({ sku: l.sku, nodig: l.qty, tekort: Math.abs(rest) });
      }
      /* Verzendkosten alleen meesturen als de HELE order uit het magazijn komt —
         anders zou een gesplitste order de verzendkosten dubbel in SRS zetten. */
      const shippingCents = storeParts === 0 ? Number(r.shipping_cents) || 0 : 0;
      return {
        orderNumber: r.order_number,
        createdAt: r.created_at,
        locale: r.locale || "nl",
        currency: r.currency || "EUR",
        customer: {
          email: r.email || "",
          firstName: r.first_name || "",
          lastName: r.last_name || "",
          companyName: r.company_name || "",
          phone: r.phone || "",
        },
        address: {
          street: r.street || "",
          houseNumber: r.house_number || "",
          postalCode: r.postal_code || "",
          city: r.city || "",
          country: r.country || "NL",
        },
        lines,
        /* Bedragen van het MAGAZIJN-deel (niet de hele order) — dit is wat het
           magazijn picket en wat als betaald in SRS moet staan. */
        linesCents,
        shippingCents,
        warehousePaidCents: linesCents + shippingCents,
        /* Context: is dit een gesplitste order (ook winkel-delen)? Dan is het
           SRS-deel bewust een deellevering en klopt het ordertotaal niet. */
        isPartial: storeParts > 0,
        storeParts,
        orderTotalCents: Number(r.total_cents) || 0,
        /* false = niet pushen; het magazijn heeft dit (volgens de verse telling)
           niet meer liggen. */
        stockOk: tekorten.length === 0,
        tekorten,
      };
    });

    return NextResponse.json({ ok: true, since: since.toISOString(), count: orders.length, orders });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/**
 * POST — markeer een order als gepusht naar SRS (idempotent: een order die al een
 * srs_pushed_at heeft blijft ongemoeid, tenzij force). Zet `pushed: false` om de
 * markering te wissen (handmatig herstel na een mislukte push).
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { orderNumber?: string; srsOrderId?: string; pushed?: boolean; force?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const orderNumber = String(body?.orderNumber || "").trim();
  if (!orderNumber) {
    return NextResponse.json({ ok: false, error: "orderNumber vereist." }, { status: 400 });
  }
  const pushed = body?.pushed !== false;
  const force = body?.force === true;

  try {
    const db = getDb();
    if (!pushed) {
      const res = await db.execute<{ order_number: string }>(sql`
        update orders set srs_pushed_at = null, updated_at = now()
        where order_number = ${orderNumber}
        returning order_number`);
      return NextResponse.json({ ok: res.rows.length > 0, cleared: res.rows.length > 0 });
    }
    /* Alleen zetten als 'ie nog leeg is: zo blijft het eerste push-moment staan en
       kan een dubbele cron-run de markering niet verschuiven. */
    const res = await db.execute<{ order_number: string }>(sql`
      update orders set srs_pushed_at = now(), updated_at = now()
      where order_number = ${orderNumber}
        ${force ? sql`` : sql`and srs_pushed_at is null`}
      returning order_number`);
    if (!res.rows.length) {
      // Bestaat de order wel? Dan was 'ie al gemarkeerd (idempotent → ok).
      const exists = await db.execute<{ srs_pushed_at: string | null }>(
        sql`select to_char(srs_pushed_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') srs_pushed_at
            from orders where order_number = ${orderNumber}`,
      );
      if (!exists.rows.length) {
        return NextResponse.json({ ok: false, error: "Order niet gevonden." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, alreadyPushed: true, pushedAt: exists.rows[0].srs_pushed_at });
    }
    return NextResponse.json({ ok: true, marked: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
