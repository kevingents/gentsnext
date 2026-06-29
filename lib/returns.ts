import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, orderLines, returns, returnLines, giftcards } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { createReturnLabel, dhlConfigured, type ReturnAddress } from "@/lib/dhl";
import { refundMolliePayment } from "@/lib/mollie";
import { reverseOrderLoyalty } from "@/lib/loyalty-claim";
import { sendReturnRegistered, sendReturnRefunded } from "@/lib/email";

/**
 * Retouren — klant start vanuit z'n bestelling. Methode: DHL-retourlabel of in de
 * winkel. Vergoeding: geld terug (Mollie-refund, evt. minus retourkosten) of store
 * credit (cadeaubon, volledige waarde → gratis retour). Store credit / in-winkel =
 * gratis. Store credit wordt pas uitgegeven bij ontvangst van de retour.
 */

export type ReturnMethod = "dhl" | "store";
export type RefundType = "money" | "credit";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function creditCode(): string {
  const b = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return `TEGOED-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

type ReturnableLine = {
  orderLineId: string;
  sku: string;
  title: string;
  size: string;
  color: string;
  unitPriceCents: number;
  orderedQty: number;
  returnableQty: number;
};

/** Haal de bestelling + de nog-retourbare regels op (na aftrek van eerdere retouren). */
export async function getReturnableOrder(orderNumber: string, email: string): Promise<
  | { ok: true; orderId: string; orderNumber: string; withinWindow: boolean; lines: ReturnableLine[] }
  | { ok: false; error: string }
> {
  const nr = String(orderNumber || "").trim();
  const mail = String(email || "").trim().toLowerCase();
  if (!nr || !mail) return { ok: false, error: "Vul je bestelnummer en e-mailadres in." };

  const db = getDb();
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderNumber, nr), sql`lower(${orders.email}) = ${mail}`))
    .limit(1);
  if (!order) return { ok: false, error: "Geen bestelling gevonden met dit nummer + e-mailadres." };
  if (!["paid", "shipped", "delivered", "ready_pickup"].includes(order.status)) {
    return { ok: false, error: "Deze bestelling kan (nog) niet geretourneerd worden." };
  }

  const { returnConfig } = await getSettings();
  const since = order.paidAt ?? order.createdAt;
  const withinWindow = since ? Date.now() - new Date(since).getTime() <= returnConfig.windowDays * 86400000 : true;

  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, order.id));

  // Reeds geretourneerde aantallen per orderregel (lopende/voltooide retouren).
  const priorReturns = await db
    .select({ id: returns.id })
    .from(returns)
    .where(and(eq(returns.orderId, order.id), sql`${returns.status} <> 'cancelled'`));
  const priorByLine = new Map<string, number>();
  if (priorReturns.length) {
    const rl = await db
      .select({ orderLineId: returnLines.orderLineId, qty: returnLines.qty })
      .from(returnLines)
      .where(inArray(returnLines.returnId, priorReturns.map((r) => r.id)));
    for (const r of rl) if (r.orderLineId) priorByLine.set(r.orderLineId, (priorByLine.get(r.orderLineId) || 0) + r.qty);
  }

  const returnable: ReturnableLine[] = lines.map((l) => ({
    orderLineId: l.id,
    sku: l.sku,
    title: l.title,
    size: l.size,
    color: l.color,
    unitPriceCents: l.unitPriceCents,
    orderedQty: l.quantity,
    returnableQty: Math.max(0, l.quantity - (priorByLine.get(l.id) || 0)),
  }));

  return { ok: true, orderId: order.id, orderNumber: order.orderNumber, withinWindow, lines: returnable };
}

export type CreateReturnInput = {
  orderNumber: string;
  email: string;
  items: { orderLineId: string; qty: number }[];
  method: ReturnMethod;
  refundType: RefundType;
  pickupStore?: string;
  reason?: string;
};

export async function createReturn(input: CreateReturnInput): Promise<
  | { ok: true; id: string; status: string; itemsCents: number; shippingCostCents: number; refundType: RefundType; method: ReturnMethod; label: { url: string; base64: string; tracking: string } | null; labelPending: boolean }
  | { ok: false; error: string }
> {
  const base = await getReturnableOrder(input.orderNumber, input.email);
  if (!base.ok) return base;
  if (!base.withinWindow) return { ok: false, error: "De retourtermijn voor deze bestelling is verstreken." };

  const byId = new Map(base.lines.map((l) => [l.orderLineId, l]));
  const picked: { line: ReturnableLine; qty: number }[] = [];
  for (const it of input.items || []) {
    const line = byId.get(String(it.orderLineId));
    const qty = Math.max(0, Math.round(Number(it.qty) || 0));
    if (!line || qty === 0) continue;
    if (qty > line.returnableQty) return { ok: false, error: `Meer geretourneerd dan besteld voor "${line.title}".` };
    picked.push({ line, qty });
  }
  if (!picked.length) return { ok: false, error: "Selecteer minimaal één artikel om te retourneren." };

  const method: ReturnMethod = input.method === "store" ? "store" : "dhl";
  const refundType: RefundType = input.refundType === "credit" ? "credit" : "money";
  const itemsCents = picked.reduce((s, p) => s + p.qty * p.line.unitPriceCents, 0);

  const { returnConfig } = await getSettings();
  // Gratis retour bij in-winkel inleveren OF bij store credit/omruilen (instelbaar).
  const free = method === "store" || (refundType === "credit" && returnConfig.freeOnCredit);
  const shippingCostCents = free ? 0 : returnConfig.dhlReturnCostCents;

  const db = getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, base.orderId)).limit(1);

  const [ret] = await db
    .insert(returns)
    .values({
      orderId: base.orderId,
      orderNumber: base.orderNumber,
      email: input.email.trim().toLowerCase(),
      status: "requested",
      method,
      refundType,
      pickupStore: method === "store" ? (input.pickupStore || "").trim() : "",
      reason: (input.reason || "").trim().slice(0, 500),
      itemsCents,
      shippingCostCents,
    })
    .returning({ id: returns.id });

  await db.insert(returnLines).values(
    picked.map((p) => ({
      returnId: ret.id,
      orderLineId: p.line.orderLineId,
      sku: p.line.sku,
      title: p.line.title,
      size: p.line.size,
      color: p.line.color,
      qty: p.qty,
      unitPriceCents: p.line.unitPriceCents,
      reason: (input.reason || "").trim().slice(0, 200),
    })),
  );

  // DHL-retourlabel (env-gated). Lukt het niet → retour blijft 'requested', label volgt.
  let label: { url: string; base64: string; tracking: string } | null = null;
  let labelPending = method === "dhl";
  if (method === "dhl" && dhlConfigured() && order) {
    const addr: ReturnAddress = {
      name: `${order.firstName} ${order.lastName}`.trim(),
      street: order.street,
      number: order.houseNumber,
      postalCode: order.postalCode,
      city: order.city,
      country: order.country || "NL",
      email: order.email,
    };
    const res = await createReturnLabel(base.orderNumber, addr);
    if (res.ok) {
      label = { url: res.labelUrl || "", base64: res.labelBase64 || "", tracking: res.tracking || "" };
      labelPending = false;
      await db
        .update(returns)
        .set({ status: "label_created", dhlLabelUrl: res.labelUrl || "", dhlTracking: res.tracking || "", updatedAt: sql`now()` })
        .where(eq(returns.id, ret.id));
    }
  }

  // Bevestigingsmail naar de klant (env-gated; faalt stil zodat de retour blijft staan).
  try {
    await sendReturnRegistered({
      email: input.email.trim().toLowerCase(),
      firstName: order?.firstName || "",
      orderNumber: base.orderNumber,
      method,
      refundType,
      items: picked.map((p) => ({ title: p.line.title, size: p.line.size, color: p.line.color, qty: p.qty })),
      labelUrl: label?.url || "",
      tracking: label?.tracking || "",
      itemsCents,
      shippingCostCents,
      pickupStore: method === "store" ? (input.pickupStore || "").trim() : "",
    });
  } catch (e) {
    console.error("[returns] bevestigingsmail mislukt:", (e as Error).message);
  }

  return { ok: true, id: ret.id, status: labelPending ? "requested" : method === "dhl" ? "label_created" : "requested", itemsCents, shippingCostCents, refundType, method, label, labelPending };
}

/** Geef store credit uit als een (direct bruikbare) cadeaubon. */
export async function issueStoreCredit(amountCents: number, email: string, customerId: string | null, reason = "Retour-tegoed"): Promise<string> {
  const db = getDb();
  const { giftcardConfig } = await getSettings();
  const expiresAt = new Date(Date.now() + (giftcardConfig.validityMonths || 24) * 30 * 86400000);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = creditCode();
    const rows = await db
      .insert(giftcards)
      .values({
        code,
        initialCents: amountCents,
        balanceCents: amountCents,
        status: "active",
        recipientEmail: email.trim().slice(0, 160),
        senderName: "GENTS",
        message: reason.slice(0, 200),
        customerId: customerId ?? null,
        expiresAt,
        issuedAt: sql`now()` as unknown as Date,
      })
      .onConflictDoNothing()
      .returning({ code: giftcards.code });
    if (rows.length) return rows[0].code;
  }
  throw new Error("Kon geen tegoed-code genereren.");
}

/**
 * Retour ontvangen → vergoeden. Geld terug = Mollie-refund (items − retourkosten);
 * store credit = volledige itemwaarde als cadeaubon. Idempotent: al voltooid → no-op.
 */
export async function processReturnReceived(returnId: string): Promise<{ ok: boolean; status: string; refundedCents?: number; creditCode?: string; error?: string }> {
  const db = getDb();
  const [ret] = await db.select().from(returns).where(eq(returns.id, returnId)).limit(1);
  if (!ret) return { ok: false, status: "", error: "Retour niet gevonden." };
  if (ret.status === "completed") return { ok: true, status: "completed", refundedCents: ret.refundedCents, creditCode: ret.creditCode };

  await db.update(returns).set({ status: "received", updatedAt: sql`now()` }).where(eq(returns.id, ret.id));

  const [order] = await db
    .select({ customerId: orders.customerId, molliePaymentId: orders.molliePaymentId, firstName: orders.firstName })
    .from(orders)
    .where(eq(orders.id, ret.orderId))
    .limit(1);

  async function mailRefunded(refundType: RefundType, amountCents: number, code: string) {
    try {
      await sendReturnRefunded({ email: ret.email, firstName: order?.firstName || "", orderNumber: ret.orderNumber, refundType, amountCents, creditCode: code });
    } catch (e) {
      console.error("[returns] verwerk-mail mislukt:", (e as Error).message);
    }
  }

  if (ret.refundType === "credit") {
    const code = await issueStoreCredit(ret.itemsCents, ret.email, order?.customerId ?? null, `Retour ${ret.orderNumber}`);
    await db.update(returns).set({ status: "completed", creditCode: code, refundedCents: ret.itemsCents, updatedAt: sql`now()` }).where(eq(returns.id, ret.id));
    if (order?.customerId) {
      try { await reverseOrderLoyalty(order.customerId, ret.orderId, ret.itemsCents, ret.id); }
      catch (e) { console.warn("[returns] punten terugdraaien mislukt:", (e as Error).message); }
    }
    await mailRefunded("credit", ret.itemsCents, code);
    return { ok: true, status: "completed", refundedCents: ret.itemsCents, creditCode: code };
  }

  // Geld terug: items minus retourkosten (bij DHL-label), via Mollie.
  const refundCents = Math.max(0, ret.itemsCents - ret.shippingCostCents);
  if (!order?.molliePaymentId) {
    return { ok: false, status: "received", error: "Geen Mollie-betaling gevonden — handmatig terugbetalen." };
  }
  const r = await refundMolliePayment(order.molliePaymentId, refundCents, `Retour ${ret.orderNumber}`);
  if (!r.ok) return { ok: false, status: "received", error: r.error || "Terugbetaling mislukt." };
  await db.update(returns).set({ status: "completed", refundedCents: refundCents, updatedAt: sql`now()` }).where(eq(returns.id, ret.id));
  if (order?.customerId) {
    try { await reverseOrderLoyalty(order.customerId, ret.orderId, ret.itemsCents, ret.id); }
    catch (e) { console.warn("[returns] punten terugdraaien mislukt:", (e as Error).message); }
  }
  await mailRefunded("money", refundCents, "");
  return { ok: true, status: "completed", refundedCents: refundCents };
}

/**
 * Worklist voor supply chain: retouren die fysiek ontvangen zijn maar nog terug
 * in SRS geboekt moeten worden (stockCorrectedAt = null). Pas verschijnt zodra de
 * retour de status 'received' of 'completed' heeft (= goederen daadwerkelijk binnen).
 */
export async function listAwaitingStockCorrection(limit = 100) {
  const db = getDb();
  const rows = await db
    .select()
    .from(returns)
    .where(and(inArray(returns.status, ["received", "completed"]), sql`${returns.stockCorrectedAt} is null`))
    .orderBy(desc(returns.updatedAt))
    .limit(Math.max(1, Math.min(300, limit)));
  const ids = rows.map((r) => r.id);
  const lines = ids.length ? await db.select().from(returnLines).where(inArray(returnLines.returnId, ids)) : [];
  const byRet = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = byRet.get(l.returnId) || [];
    arr.push(l);
    byRet.set(l.returnId, arr);
  }
  return rows.map((r) => ({
    id: r.id,
    orderNumber: r.orderNumber,
    method: r.method,
    pickupStore: r.pickupStore,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lines: (byRet.get(r.id) || []).map((l) => ({ sku: l.sku, title: l.title, size: l.size, color: l.color, qty: l.qty })),
  }));
}

/** Supply chain markeert de geretourneerde stuks als fysiek terug in SRS geboekt. */
export async function markStockCorrected(returnId: string, by = ""): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const [ret] = await db.select({ id: returns.id, stockCorrectedAt: returns.stockCorrectedAt }).from(returns).where(eq(returns.id, returnId)).limit(1);
  if (!ret) return { ok: false, error: "Retour niet gevonden." };
  if (ret.stockCorrectedAt) return { ok: true }; // idempotent
  await db.update(returns).set({ stockCorrectedAt: sql`now()`, stockCorrectedBy: by.slice(0, 120), updatedAt: sql`now()` }).where(eq(returns.id, returnId));
  return { ok: true };
}

/** Aantal openstaande voorraadcorrecties (voor badge/notificatie). */
export async function countAwaitingStockCorrection(): Promise<number> {
  const db = getDb();
  const r = (await db.execute<{ n: number }>(sql`select count(*)::int n from returns where status in ('received','completed') and stock_corrected_at is null`)).rows[0];
  return Number(r?.n) || 0;
}

/**
 * Verwachte retouren voor één winkel: in-winkel-retouren die de klant naar dat
 * filiaal brengt en nog niet ontvangen zijn. Zo ziet de winkel wat er aankomt.
 */
export async function listExpectedReturnsForStore(store: string, limit = 100) {
  const s = String(store || "").trim();
  if (!s) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(returns)
    .where(and(eq(returns.method, "store"), eq(returns.pickupStore, s), inArray(returns.status, ["requested", "label_created"])))
    .orderBy(desc(returns.createdAt))
    .limit(Math.max(1, Math.min(300, limit)));
  const ids = rows.map((r) => r.id);
  const lines = ids.length ? await db.select().from(returnLines).where(inArray(returnLines.returnId, ids)) : [];
  const byRet = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = byRet.get(l.returnId) || [];
    arr.push(l);
    byRet.set(l.returnId, arr);
  }
  return rows.map((r) => ({
    id: r.id,
    orderNumber: r.orderNumber,
    refundType: r.refundType,
    itemsCents: r.itemsCents,
    reason: r.reason,
    createdAt: r.createdAt,
    lines: (byRet.get(r.id) || []).map((l) => ({ sku: l.sku, title: l.title, size: l.size, color: l.color, qty: l.qty })),
  }));
}

/** Admin: recente retouren. */
export async function listReturns(limit = 100) {
  const db = getDb();
  return db.select().from(returns).orderBy(desc(returns.createdAt)).limit(Math.max(1, Math.min(500, limit)));
}

export async function getReturnWithLines(id: string) {
  const db = getDb();
  const [ret] = await db.select().from(returns).where(eq(returns.id, id)).limit(1);
  if (!ret) return null;
  const lines = await db.select().from(returnLines).where(eq(returnLines.returnId, id));
  return { ret, lines };
}

export type ReturnStats = {
  days: number;
  count: number;
  itemsCents: number;
  refundedMoneyCents: number;
  creditIssuedCents: number;
  creditSharePct: number; // % dat voor tegoed/omruilen koos
  storeSharePct: number; // % dat in de winkel inlevert
  returnRatePct: number; // geretourneerde stuks ÷ verkochte stuks
  avgDaysToReturn: number; // gem. dagen bestelling → retour-aanmelding
  pendingCount: number; // nog te verwerken (niet completed/cancelled)
  pendingValueCents: number;
  byStatus: { status: string; n: number }[];
  byLand: { land: string; n: number }[];
  topReasons: { reason: string; n: number }[];
  topProducts: { title: string; qty: number }[];
  topSizes: { size: string; qty: number }[];
};

/** Een product dat snel én vaak terugkomt — een aandachtspunt (pasvorm/kwaliteit?). */
export type ReturnSignal = {
  sku: string;
  title: string;
  soldQty: number;
  returnedQty: number;
  returnRatePct: number;
  avgDaysToReturn: number;
  severity: "hoog" | "midden";
};

/** Retour-statistieken over de laatste N dagen (voor het admin-dashboard). */
export async function getReturnStats(days = 90): Promise<ReturnStats> {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const t = (await db.execute<{ n: number; items: number; money: number; credit: number; credit_n: number; store_n: number }>(sql`
    select count(*)::int n,
      coalesce(sum(items_cents),0)::int items,
      coalesce(sum(case when refund_type='money' and status='completed' then refunded_cents else 0 end),0)::int money,
      coalesce(sum(case when refund_type='credit' and status='completed' then refunded_cents else 0 end),0)::int credit,
      coalesce(sum(case when refund_type='credit' then 1 else 0 end),0)::int credit_n,
      coalesce(sum(case when method='store' then 1 else 0 end),0)::int store_n
    from returns where created_at >= ${since} and status <> 'cancelled'`)).rows[0] || { n: 0, items: 0, money: 0, credit: 0, credit_n: 0, store_n: 0 };

  const byStatus = (await db.execute<{ status: string; n: number }>(sql`
    select status, count(*)::int n from returns where created_at >= ${since} group by status order by n desc`)).rows;
  const topReasons = (await db.execute<{ reason: string; n: number }>(sql`
    select reason, count(*)::int n from returns where created_at >= ${since} and status<>'cancelled' and reason <> '' group by reason order by n desc limit 6`)).rows;
  const topProducts = (await db.execute<{ title: string; qty: number }>(sql`
    select rl.title, sum(rl.qty)::int qty from return_lines rl join returns r on r.id = rl.return_id
    where r.created_at >= ${since} and r.status <> 'cancelled' group by rl.title order by qty desc limit 6`)).rows;
  const topSizes = (await db.execute<{ size: string; qty: number }>(sql`
    select rl.size, sum(rl.qty)::int qty from return_lines rl join returns r on r.id = rl.return_id
    where r.created_at >= ${since} and r.status <> 'cancelled' and rl.size <> '' group by rl.size order by qty desc limit 6`)).rows;

  const returnedQ = (await db.execute<{ q: number }>(sql`
    select coalesce(sum(rl.qty),0)::int q from return_lines rl join returns r on r.id = rl.return_id
    where r.created_at >= ${since} and r.status <> 'cancelled'`)).rows[0]?.q || 0;
  const soldQ = (await db.execute<{ q: number }>(sql`
    select coalesce(sum(ol.quantity),0)::int q from order_lines ol join orders o on o.id = ol.order_id
    where o.created_at >= ${since} and o.status in ('paid','shipped','delivered','ready_pickup')`)).rows[0]?.q || 0;

  const avgDays = (await db.execute<{ d: number }>(sql`
    select coalesce(avg(extract(epoch from (r.created_at - coalesce(o.paid_at, o.created_at)))/86400.0),0)::float d
    from returns r join orders o on o.id = r.order_id where r.created_at >= ${since} and r.status <> 'cancelled'`)).rows[0]?.d || 0;
  const pending = (await db.execute<{ n: number; v: number }>(sql`
    select count(*)::int n, coalesce(sum(items_cents),0)::int v from returns
    where created_at >= ${since} and status in ('requested','label_created','received')`)).rows[0] || { n: 0, v: 0 };
  const byLand = (await db.execute<{ land: string; n: number }>(sql`
    select coalesce(nullif(o.country,''),'NL') land, count(*)::int n from returns r join orders o on o.id = r.order_id
    where r.created_at >= ${since} and r.status <> 'cancelled' group by land order by n desc`)).rows;

  const round1 = (x: number) => Math.round(x * 10) / 10;
  return {
    days,
    count: t.n,
    itemsCents: t.items,
    refundedMoneyCents: t.money,
    creditIssuedCents: t.credit,
    creditSharePct: t.n ? round1((t.credit_n / t.n) * 100) : 0,
    storeSharePct: t.n ? round1((t.store_n / t.n) * 100) : 0,
    returnRatePct: soldQ ? round1((returnedQ / soldQ) * 100) : 0,
    avgDaysToReturn: round1(avgDays),
    pendingCount: pending.n,
    pendingValueCents: pending.v,
    byStatus,
    byLand,
    topReasons,
    topProducts,
    topSizes,
  };
}

/**
 * Signalen: producten die SNEL én VAAK retour komen — een aandachtspunt voor
 * pasvorm/kwaliteit. Per SKU: geretourneerd ÷ verkocht (retourpercentage) +
 * gemiddelde dagen tot retour. Drempels uit settings.returnConfig.
 */
export async function getReturnSignals(days = 90): Promise<ReturnSignal[]> {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { returnConfig: c } = await getSettings();

  const rows = (await db.execute<{ sku: string; title: string; returned_qty: number; sold_qty: number; avg_days: number }>(sql`
    with ret as (
      select rl.sku,
             max(rl.title) title,
             sum(rl.qty)::int returned_qty,
             avg(extract(epoch from (r.created_at - coalesce(o.paid_at, o.created_at)))/86400.0)::float avg_days
      from return_lines rl
      join returns r on r.id = rl.return_id
      join orders o on o.id = r.order_id
      where r.created_at >= ${since} and r.status <> 'cancelled' and rl.sku <> ''
      group by rl.sku
    ), sold as (
      select ol.sku, sum(ol.quantity)::int sold_qty
      from order_lines ol join orders o on o.id = ol.order_id
      where o.created_at >= ${since} and o.status in ('paid','shipped','delivered','ready_pickup') and ol.sku <> ''
      group by ol.sku
    )
    select ret.sku, ret.title, ret.returned_qty, coalesce(sold.sold_qty,0) sold_qty, ret.avg_days
    from ret left join sold on sold.sku = ret.sku
    where ret.returned_qty >= ${c.signalMinReturns}
  `)).rows;

  const round1 = (x: number) => Math.round(x * 10) / 10;
  const signals: ReturnSignal[] = [];
  for (const r of rows) {
    const sold = Number(r.sold_qty) || 0;
    const ret = Number(r.returned_qty) || 0;
    const rate = sold ? (ret / sold) * 100 : 100; // geen verkoop-match → 100% (alleen retour bekend)
    const avgDays = round1(Number(r.avg_days) || 0);
    if (rate < c.signalMinRatePct) continue;
    const fast = avgDays <= c.signalFastDays;
    if (!fast && rate < c.signalMinRatePct * 1.5) continue; // niet-snel telt alleen bij erg hoog %
    signals.push({
      sku: r.sku,
      title: r.title || r.sku,
      soldQty: sold,
      returnedQty: ret,
      returnRatePct: round1(rate),
      avgDaysToReturn: avgDays,
      severity: rate >= c.signalMinRatePct * 1.5 && fast ? "hoog" : "midden",
    });
  }
  return signals.sort((a, b) => b.returnRatePct - a.returnRatePct).slice(0, 12);
}
