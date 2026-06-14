import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/**
 * Back-office rapportage-laag. Alle aggregaties server-side (schaal: 35k orders,
 * 46k klanten). Bedragen in centen. Categorie/merk joinen we via
 * sku → product_variants → products, want geïmporteerde Shopify-orderregels
 * hebben wél een sku maar geen product_handle.
 */

export type Range = { from: Date; to: Date };

/** Datumbereik uit query-params (?from=YYYY-MM-DD&to=YYYY-MM-DD), default 30 dagen. */
export function parseRange(sp: { from?: string; to?: string }): Range {
  const to = sp.to ? new Date(sp.to + "T23:59:59") : new Date();
  const from = sp.from ? new Date(sp.from + "T00:00:00") : new Date(to.getTime() - 30 * 86400000);
  return { from: isNaN(from.getTime()) ? new Date(Date.now() - 30 * 86400000) : from, to: isNaN(to.getTime()) ? new Date() : to };
}

const PAID = sql`status in ('paid','shipped','ready_pickup','delivered')`;

/* ── Statistieken / KPI's ── */

export type Kpis = {
  revenueCents: number;
  orders: number;
  aovCents: number;
  refundCents: number;
  refundOrders: number;
  itemsSold: number;
  discountCents: number;
  giftcardCents: number;
  newCustomers: number;
  storeRevenueCents: number;
  storeOrders: number;
};

export async function getKpis(r: Range): Promise<Kpis> {
  const db = getDb();
  const [o] = (
    await db.execute<{ rev: string; n: string; items: string; disc: string; gift: string }>(sql`
      select coalesce(sum(total_cents),0) rev, count(*) n,
             coalesce(sum(discount_cents),0) disc, coalesce(sum(giftcard_cents),0) gift,
             (select coalesce(sum(quantity),0) from order_lines ol join orders o2 on o2.id=ol.order_id
               where ${PAID} and o2.created_at between ${r.from} and ${r.to}) items
      from orders where ${PAID} and created_at between ${r.from} and ${r.to}`)
  ).rows;
  const [ref] = (
    await db.execute<{ rev: string; n: string }>(sql`
      select coalesce(sum(total_cents),0) rev, count(*) n from orders
      where status='refunded' and created_at between ${r.from} and ${r.to}`)
  ).rows;
  const [nc] = (
    await db.execute<{ n: string }>(sql`select count(*) n from customers where created_at between ${r.from} and ${r.to}`)
  ).rows;
  const [sp] = (
    await db.execute<{ rev: string; n: string }>(sql`
      select coalesce(sum(total_cents),0) rev, count(*) n from store_purchases
      where purchased_at between ${r.from} and ${r.to}`)
  ).rows;
  const orders = Number(o.n) || 0;
  const revenueCents = Number(o.rev) || 0;
  return {
    revenueCents,
    orders,
    aovCents: orders ? Math.round(revenueCents / orders) : 0,
    refundCents: Number(ref.rev) || 0,
    refundOrders: Number(ref.n) || 0,
    itemsSold: Number(o.items) || 0,
    discountCents: Number(o.disc) || 0,
    giftcardCents: Number(o.gift) || 0,
    newCustomers: Number(nc.n) || 0,
    storeRevenueCents: Number(sp.rev) || 0,
    storeOrders: Number(sp.n) || 0,
  };
}

export async function revenueByDay(r: Range): Promise<{ day: string; revenueCents: number; orders: number }[]> {
  const db = getDb();
  const rows = await db.execute<{ dag: string; rev: string; n: string }>(sql`
    select to_char(date_trunc('day', created_at),'YYYY-MM-DD') as dag,
           coalesce(sum(total_cents),0) rev, count(*) n
    from orders where ${PAID} and created_at between ${r.from} and ${r.to}
    group by 1 order by 1`);
  return rows.rows.map((x) => ({ day: x.dag, revenueCents: Number(x.rev) || 0, orders: Number(x.n) || 0 }));
}

export async function topProducts(r: Range, limit = 20): Promise<{ title: string; sku: string; qty: number; revenueCents: number }[]> {
  const db = getDb();
  const rows = await db.execute<{ title: string; sku: string; qty: string; rev: string }>(sql`
    select coalesce(nullif(ol.title,''), ol.sku) title, ol.sku,
           sum(ol.quantity) qty, sum(ol.unit_price_cents*ol.quantity) rev
    from order_lines ol join orders o on o.id=ol.order_id
    where ${PAID} and o.created_at between ${r.from} and ${r.to}
    group by 1, ol.sku order by rev desc limit ${limit}`);
  return rows.rows.map((x) => ({ title: x.title, sku: x.sku, qty: Number(x.qty) || 0, revenueCents: Number(x.rev) || 0 }));
}

export async function revenueByCategory(r: Range): Promise<{ category: string; qty: number; revenueCents: number }[]> {
  const db = getDb();
  // Join via sku → variant → product (werkt ook voor geïmporteerde regels zonder handle).
  const rows = await db.execute<{ cat: string; qty: string; rev: string }>(sql`
    select coalesce(nullif(p.attributes->>'hoofdgroep_omschrijving',''),'Overig') cat,
           sum(ol.quantity) qty, sum(ol.unit_price_cents*ol.quantity) rev
    from order_lines ol
    join orders o on o.id=ol.order_id
    left join product_variants v on v.sku=ol.sku
    left join products p on p.id=v.product_id
    where o.status in ('paid','shipped','ready_pickup','delivered') and o.created_at between ${r.from} and ${r.to}
    group by 1 order by rev desc`);
  return rows.rows.map((x) => ({ category: x.cat, qty: Number(x.qty) || 0, revenueCents: Number(x.rev) || 0 }));
}

export async function statusDistribution(r: Range): Promise<{ status: string; n: number; revenueCents: number }[]> {
  const db = getDb();
  const rows = await db.execute<{ status: string; n: string; rev: string }>(sql`
    select status, count(*) n, coalesce(sum(total_cents),0) rev from orders
    where created_at between ${r.from} and ${r.to} group by status order by n desc`);
  return rows.rows.map((x) => ({ status: x.status, n: Number(x.n) || 0, revenueCents: Number(x.rev) || 0 }));
}

/* ── Order-overzicht (gepagineerd + zoeken/filteren) ── */

export type OrderListOpts = {
  search?: string;
  status?: string;
  channel?: "online" | "import" | "store" | "";
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

export async function listOrders(opts: OrderListOpts) {
  const db = getDb();
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(200, Math.max(10, opts.pageSize || 50));
  const conds = [sql`1=1`];
  if (opts.search) {
    const q = `%${opts.search.trim().toLowerCase()}%`;
    conds.push(sql`(lower(order_number) like ${q} or lower(email) like ${q} or lower(first_name||' '||last_name) like ${q} or lower(postal_code) like ${q})`);
  }
  if (opts.status) conds.push(sql`status = ${opts.status}`);
  if (opts.channel === "online") conds.push(sql`mollie_payment_id is not null and fulfillment_status <> 'imported'`);
  if (opts.channel === "import") conds.push(sql`fulfillment_status = 'imported'`);
  if (opts.from) conds.push(sql`created_at >= ${opts.from}`);
  if (opts.to) conds.push(sql`created_at <= ${opts.to}`);
  const where = sql.join(conds, sql` and `);

  const [{ n }] = (await db.execute<{ n: string }>(sql`select count(*) n from orders where ${where}`)).rows;
  const rows = await db.execute<{
    order_number: string; status: string; email: string; name: string; city: string;
    total_cents: number; created_at: string; fulfillment_status: string; channel: string;
  }>(sql`
    select order_number, status, email, (first_name||' '||last_name) name, city, total_cents,
           to_char(created_at,'YYYY-MM-DD') created_at, fulfillment_status,
           case when fulfillment_status='imported' then 'import' when mollie_payment_id is not null then 'online' else 'online' end channel
    from orders where ${where}
    order by created_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`);
  return {
    total: Number(n) || 0,
    page,
    pageSize,
    rows: rows.rows.map((x) => ({
      orderNumber: x.order_number, status: x.status, email: x.email, name: (x.name || "").trim(),
      city: x.city, totalCents: Number(x.total_cents) || 0, createdAt: x.created_at,
      fulfillmentStatus: x.fulfillment_status, channel: x.channel,
    })),
  };
}

/* ── CSV-export (orders + klanten) ── */

const EXPORT_CAP = 100_000;

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Excel-vriendelijk: UTF-8 BOM, puntkomma-scheiding, CRLF. */
function toCsv(header: string[], rows: (string | number)[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}
function euros(cents: number): string {
  return ((Number(cents) || 0) / 100).toFixed(2).replace(".", ",");
}

/** Volledige order-export (zelfde filters als het overzicht, geen paginatie). */
export async function exportOrders(opts: OrderListOpts): Promise<string> {
  const db = getDb();
  const conds = [sql`1=1`];
  if (opts.search) {
    const q = `%${opts.search.trim().toLowerCase()}%`;
    conds.push(sql`(lower(order_number) like ${q} or lower(email) like ${q} or lower(first_name||' '||last_name) like ${q} or lower(postal_code) like ${q})`);
  }
  if (opts.status) conds.push(sql`status = ${opts.status}`);
  if (opts.channel === "online") conds.push(sql`mollie_payment_id is not null and fulfillment_status <> 'imported'`);
  if (opts.channel === "import") conds.push(sql`fulfillment_status = 'imported'`);
  if (opts.from) conds.push(sql`created_at >= ${opts.from}`);
  if (opts.to) conds.push(sql`created_at <= ${opts.to}`);
  const where = sql.join(conds, sql` and `);
  const rows = await db.execute<{
    order_number: string; created_at: string; status: string; channel: string; fulfillment_status: string;
    email: string; name: string; postal_code: string; city: string;
    total_cents: number; discount_cents: number; giftcard_cents: number;
  }>(sql`
    select order_number, to_char(created_at,'YYYY-MM-DD HH24:MI') created_at, status,
           case when fulfillment_status='imported' then 'import' when mollie_payment_id is not null then 'online' else 'online' end channel,
           fulfillment_status, email, (first_name||' '||last_name) name, coalesce(postal_code,'') postal_code, coalesce(city,'') city,
           total_cents, coalesce(discount_cents,0) discount_cents, coalesce(giftcard_cents,0) giftcard_cents
    from orders where ${where}
    order by created_at desc limit ${EXPORT_CAP}`);
  return toCsv(
    ["Ordernummer", "Datum", "Status", "Kanaal", "Fulfilment", "E-mail", "Naam", "Postcode", "Plaats", "Totaal", "Korting", "Cadeaubon"],
    rows.rows.map((x) => [
      x.order_number, x.created_at, x.status, x.channel, x.fulfillment_status, x.email, (x.name || "").trim(),
      x.postal_code, x.city, euros(x.total_cents), euros(x.discount_cents), euros(x.giftcard_cents),
    ]),
  );
}

/** Volledige klant-export (zelfde zoekfilter als het overzicht). */
export async function exportCustomers(opts: CustomerListOpts): Promise<string> {
  const db = getDb();
  const conds = [sql`1=1`];
  if (opts.search) {
    const q = `%${opts.search.trim().toLowerCase()}%`;
    conds.push(sql`(lower(c.email) like ${q} or lower(c.first_name||' '||c.last_name) like ${q} or c.phone like ${q} or c.srs_customer_id like ${q})`);
  }
  const where = sql.join(conds, sql` and `);
  const paidFilter = sql`o.status in ('paid','shipped','ready_pickup','delivered')`;
  const rows = await db.execute<{
    email: string; name: string; phone: string; srs: string;
    orders_count: string; spent_cents: string; created_at: string;
  }>(sql`
    select c.email, (c.first_name||' '||c.last_name) name, coalesce(c.phone,'') phone, coalesce(c.srs_customer_id,'') srs,
           count(o.id) filter (where ${paidFilter}) orders_count,
           coalesce(sum(o.total_cents) filter (where ${paidFilter}),0) spent_cents,
           to_char(c.created_at,'YYYY-MM-DD') created_at
    from customers c left join orders o on o.customer_id = c.id
    where ${where}
    group by c.id, c.email, c.first_name, c.last_name, c.phone, c.srs_customer_id, c.created_at
    order by spent_cents desc limit ${EXPORT_CAP}`);
  return toCsv(
    ["E-mail", "Naam", "Telefoon", "SRS-id", "Orders", "Besteed", "Klant sinds"],
    rows.rows.map((x) => [x.email, (x.name || "").trim(), x.phone, x.srs, Number(x.orders_count) || 0, euros(Number(x.spent_cents)), x.created_at]),
  );
}

/* ── Klantoverzicht (gepagineerd + zoeken) + detail ── */

export type CustomerListOpts = { search?: string; page?: number; pageSize?: number; sort?: "spent" | "orders" | "recent" };

export async function listCustomers(opts: CustomerListOpts) {
  const db = getDb();
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(200, Math.max(10, opts.pageSize || 50));
  const conds = [sql`1=1`];
  if (opts.search) {
    const q = `%${opts.search.trim().toLowerCase()}%`;
    conds.push(sql`(lower(c.email) like ${q} or lower(c.first_name||' '||c.last_name) like ${q} or c.phone like ${q} or c.srs_customer_id like ${q})`);
  }
  const where = sql.join(conds, sql` and `);
  const order = opts.sort === "orders" ? sql`orders_count desc` : opts.sort === "recent" ? sql`created_at desc` : sql`spent_cents desc`;
  const paidFilter = sql`o.status in ('paid','shipped','ready_pickup','delivered')`;

  const [{ n }] = (await db.execute<{ n: string }>(sql`select count(*) n from customers c where ${where}`)).rows;
  // Eén JOIN + GROUP BY (geen subquery per klant) — schaalt over 46k klanten.
  const rows = await db.execute<{
    id: string; email: string; name: string; phone: string; srs: string;
    orders_count: string; spent_cents: string; created_at: string;
  }>(sql`
    select c.id, c.email, (c.first_name||' '||c.last_name) name, c.phone, coalesce(c.srs_customer_id,'') srs,
           count(o.id) filter (where ${paidFilter}) orders_count,
           coalesce(sum(o.total_cents) filter (where ${paidFilter}),0) spent_cents,
           to_char(c.created_at,'YYYY-MM-DD') created_at
    from customers c
    left join orders o on o.customer_id = c.id
    where ${where}
    group by c.id, c.email, c.first_name, c.last_name, c.phone, c.srs_customer_id, c.created_at
    order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`);
  return {
    total: Number(n) || 0,
    page,
    pageSize,
    rows: rows.rows.map((x) => ({
      id: x.id, email: x.email, name: (x.name || "").trim(), phone: x.phone, srsCustomerId: x.srs,
      orders: Number(x.orders_count) || 0, spentCents: Number(x.spent_cents) || 0, createdAt: x.created_at,
    })),
  };
}

export async function topCustomers(limit = 50) {
  return (await listCustomers({ sort: "spent", pageSize: limit })).rows;
}

/* ── Marketing / loyaliteit ── */

export async function voucherGiftcardImpact(r: Range) {
  const db = getDb();
  const [v] = (await db.execute<{ codes: string; disc: string; gcodes: string; gift: string }>(sql`
    select count(distinct nullif(voucher_code,'')) codes, coalesce(sum(discount_cents),0) disc,
           count(distinct nullif(giftcard_code,'')) gcodes, coalesce(sum(giftcard_cents),0) gift
    from orders where ${PAID} and created_at between ${r.from} and ${r.to}`)).rows;
  const [g] = (await db.execute<{ active: string; balance: string; sold: string; initial: string }>(sql`
    select count(*) filter (where status='active') active, coalesce(sum(balance_cents),0) balance,
           count(*) filter (where status<>'pending') sold, coalesce(sum(initial_cents) filter (where status<>'pending'),0) initial
    from giftcards`)).rows;
  return {
    voucherCodes: Number(v.codes) || 0, discountCents: Number(v.disc) || 0,
    giftcardCodesUsed: Number(v.gcodes) || 0, giftcardRedeemedCents: Number(v.gift) || 0,
    giftcardsSold: Number(g.sold) || 0, giftcardsInitialCents: Number(g.initial) || 0,
    giftcardsActiveCents: Number(g.balance) || 0,
  };
}

export async function newsletterStats() {
  const db = getDb();
  const rows = await db.execute<{ channel: string; n: string }>(sql`
    select channel, count(*) n from newsletter_subscribers where status='subscribed' group by channel`);
  const m = new Map(rows.rows.map((x) => [x.channel, Number(x.n) || 0]));
  return { email: m.get("email") || 0, whatsapp: m.get("whatsapp") || 0 };
}

export async function reviewStats() {
  const db = getDb();
  const [s] = (await db.execute<{ n: string; avg: string; pending: string }>(sql`
    select count(*) filter (where status='published') n,
           coalesce(avg(rating) filter (where status='published'),0) avg,
           count(*) filter (where status='pending') pending
    from reviews`)).rows;
  return { published: Number(s.n) || 0, avg: Math.round((Number(s.avg) || 0) * 10) / 10, pending: Number(s.pending) || 0 };
}

export async function funnel(days = 30) {
  const db = getDb();
  const rows = await db.execute<{ type: string; n: string }>(sql`
    select type, count(*) n from events
    where created_at >= now() - (${days} || ' days')::interval
      and type in ('pageview','product_view','add_to_cart','checkout_start','purchase')
    group by type`);
  const m = new Map(rows.rows.map((x) => [x.type, Number(x.n) || 0]));
  return {
    pageview: m.get("pageview") || 0,
    productView: m.get("product_view") || 0,
    addToCart: m.get("add_to_cart") || 0,
    checkoutStart: m.get("checkout_start") || 0,
    purchase: m.get("purchase") || 0,
  };
}
