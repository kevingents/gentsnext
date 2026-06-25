import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, orderLines, returns, returnLines, giftcards } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { createReturnLabel, dhlConfigured, type ReturnAddress } from "@/lib/dhl";
import { refundMolliePayment } from "@/lib/mollie";

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

  if (ret.refundType === "credit") {
    const [order] = await db.select({ customerId: orders.customerId }).from(orders).where(eq(orders.id, ret.orderId)).limit(1);
    const code = await issueStoreCredit(ret.itemsCents, ret.email, order?.customerId ?? null, `Retour ${ret.orderNumber}`);
    await db.update(returns).set({ status: "completed", creditCode: code, refundedCents: ret.itemsCents, updatedAt: sql`now()` }).where(eq(returns.id, ret.id));
    return { ok: true, status: "completed", refundedCents: ret.itemsCents, creditCode: code };
  }

  // Geld terug: items minus retourkosten (bij DHL-label), via Mollie.
  const refundCents = Math.max(0, ret.itemsCents - ret.shippingCostCents);
  const [order] = await db.select({ molliePaymentId: orders.molliePaymentId }).from(orders).where(eq(orders.id, ret.orderId)).limit(1);
  if (!order?.molliePaymentId) {
    return { ok: false, status: "received", error: "Geen Mollie-betaling gevonden — handmatig terugbetalen." };
  }
  const r = await refundMolliePayment(order.molliePaymentId, refundCents, `Retour ${ret.orderNumber}`);
  if (!r.ok) return { ok: false, status: "received", error: r.error || "Terugbetaling mislukt." };
  await db.update(returns).set({ status: "completed", refundedCents: refundCents, updatedAt: sql`now()` }).where(eq(returns.id, ret.id));
  return { ok: true, status: "completed", refundedCents: refundCents };
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
