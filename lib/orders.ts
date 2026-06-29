import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, orderLines, products, productVariants } from "@/db/schema";
import { parseCare, type CareItem } from "@/lib/care";
import { getRecommendations, getOrderCrossSell, type ProductCardData } from "@/lib/catalog";
import { sendOrderConfirmation } from "@/lib/email";
import { creditOrderLoyalty } from "@/lib/loyalty-claim";
import { allocateOrder } from "@/lib/fulfillment";
import { getSettings } from "@/lib/settings";
import { validateVoucher, redeemVoucher } from "@/lib/vouchers";
import { tieredDiscountCents } from "@/lib/pricing";
import { validateGiftcard, redeemGiftcard, releaseGiftcard } from "@/lib/giftcards";
import { availableForSkus } from "@/lib/stock-reservations";
import { availableInStore } from "@/lib/store-core";
import { reserveOrderStock, releaseOrderHolds, renewOrderHolds, activeStoreHoldsBySku, WEB_POOL, type ReserveRequest } from "@/lib/store-reserve";

/**
 * Order-logica (commerce-core). Prijzen worden ALTIJD server-side uit de DB
 * gehaald — nooit het client-bedrag vertrouwen. Bedragen in centen.
 */

export type DeliveryMethod = "standard" | "express" | "pickup";

/** Gegooid wanneer de voorraad-gate een order weigert (net uitverkocht). */
export class OutOfStockError extends Error {
  titles: string[];
  skus: string[];
  constructor(titles: string[], skus: string[] = []) {
    super(`Niet meer op voorraad: ${titles.join(", ")}`);
    this.name = "OutOfStockError";
    this.titles = titles;
    this.skus = skus;
  }
}

export type CheckoutItem = {
  sku: string;
  qty: number;
  groupId?: string;
  roleLabel?: string;
};

export type CheckoutContact = {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  country?: string;
  /** Zakelijk bestellen (optioneel). */
  companyName?: string;
  vatNumber?: string;
};

/** Leesbaar, uniek ordernummer (geen botsing dankzij tijd + random). */
function generateOrderNumber(): string {
  const t = Date.now().toString(36).toUpperCase().slice(-6);
  const r = Math.floor(Math.random() * 36 ** 3)
    .toString(36)
    .toUpperCase()
    .padStart(3, "0");
  return `G${t}${r}`;
}

/** Niet-raadbaar toegangstoken voor de bevestigingslink (32 tekens, 192 bit). */
function generateAccessToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Constante-tijd-vergelijking; false bij lengteverschil of leeg token. */
function tokenEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

type ResolvedLine = {
  sku: string;
  productHandle: string;
  title: string;
  size: string;
  color: string;
  unitPriceCents: number;
  quantity: number;
  groupId?: string;
  roleLabel?: string;
};

/** Zoekt per SKU de actuele variant + prijs uit de DB. */
async function resolveLines(items: CheckoutItem[]): Promise<ResolvedLine[]> {
  const db = getDb();
  const skus = [...new Set(items.map((i) => i.sku).filter(Boolean))];
  if (!skus.length) return [];

  const rows = await db
    .select({
      sku: productVariants.sku,
      size: productVariants.size,
      color: productVariants.color,
      priceCents: productVariants.priceCents,
      handle: products.handle,
      title: products.title,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(inArray(productVariants.sku, skus), eq(products.status, "active")));

  const bySku = new Map(rows.map((r) => [r.sku, r]));
  const resolved: ResolvedLine[] = [];
  for (const item of items) {
    const v = bySku.get(item.sku);
    const qty = Math.max(1, Math.min(20, Math.floor(item.qty) || 1));
    if (!v) continue; // onbekende/inactieve sku → overslaan
    resolved.push({
      sku: v.sku,
      productHandle: v.handle,
      title: v.title,
      size: v.size,
      color: v.color,
      unitPriceCents: v.priceCents,
      quantity: qty,
      groupId: item.groupId,
      roleLabel: item.roleLabel,
    });
  }
  return resolved;
}

export type CreatedOrder = {
  id: string;
  orderNumber: string;
  accessToken: string;
  totalCents: number;
  subtotalCents: number;
  shippingCents: number;
  /** Met een cadeaubon afgeboekt bedrag (centen). */
  giftcardCents: number;
};

export async function createOrder(
  contact: CheckoutContact,
  items: CheckoutItem[],
  deliveryMethod: DeliveryMethod = "standard",
  voucherCode = "",
  giftcardCode = "",
  pickupStore = ""
): Promise<CreatedOrder> {
  const db = getDb();
  const settings = await getSettings();
  const lines = await resolveLines(items);
  if (!lines.length) throw new Error("Geen geldige producten in de bestelling.");

  const subtotalCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  // Kortingscode server-side valideren (nooit het clientbedrag vertrouwen).
  let discountCents = 0;
  let appliedCode = "";
  if (voucherCode.trim()) {
    const v = await validateVoucher(voucherCode, subtotalCents);
    if (v.valid) {
      discountCents = v.discountCents;
      appliedCode = v.code;
    }
  }
  // Staffelkorting (instelbaar, default uit): vanaf N artikelen X% op 't subtotaal.
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);
  discountCents = Math.min(subtotalCents, discountCents + tieredDiscountCents(itemCount, subtotalCents, settings.tieredDiscount));
  // Express kan alléén als de héle order rechtstreeks uit het magazijn leverbaar
  // is (snelle levering kan niet vanuit de winkels). Server-side borgen: bij een
  // split, winkel-bron of tekort zetten we stilletjes terug naar standaard —
  // zo betaalt niemand voor express die we niet kunnen waarmaken.
  let method: DeliveryMethod = deliveryMethod;
  if (method === "express") {
    const plan = await allocateOrder(
      lines.map((l) => ({ sku: l.sku, qty: l.quantity, groupId: l.groupId })),
      { country: contact.country || "NL" }
    );
    const warehouseOnly = plan.fullyAllocated && plan.splitCount === 1 && plan.shipments.every((s) => s.isWarehouse);
    if (!warehouseOnly) method = "standard";
  }

  // Verzendkosten + (optionele) express-toeslag — alles uit de instelbare settings.
  // Afhalen in winkel ('pickup') is gratis: geen verzendkosten, geen toeslag.
  const isPickup = method === "pickup";
  const baseShipping = isPickup ? 0 : subtotalCents >= settings.freeShippingCents ? 0 : settings.shippingCents;
  const surcharge = method === "express" ? settings.expressSurchargeCents : 0;
  const shippingCents = baseShipping + surcharge;
  const totalBeforeGiftcard = Math.max(0, subtotalCents - discountCents) + shippingCents;
  // Cadeaubon als betaalmiddel: dekt (een deel van) het hele bedrag incl. verzending.
  // Server-side gevalideerd; afboeking gebeurt na het aanmaken van de order.
  let giftcardCents = 0;
  let appliedGiftcard = "";
  if (giftcardCode.trim()) {
    const g = await validateGiftcard(giftcardCode, totalBeforeGiftcard);
    if (g.valid) {
      giftcardCents = g.applyCents;
      appliedGiftcard = g.code;
    }
  }
  const totalCents = Math.max(0, totalBeforeGiftcard - giftcardCents);
  const orderNumber = generateOrderNumber();
  const accessToken = generateAccessToken();

  const [order] = await db
    .insert(orders)
    .values({
      orderNumber,
      accessToken,
      status: "open",
      email: contact.email.trim(),
      firstName: contact.firstName.trim(),
      lastName: contact.lastName.trim(),
      phone: (contact.phone || "").trim(),
      street: contact.street.trim(),
      houseNumber: contact.houseNumber.trim(),
      postalCode: contact.postalCode.trim(),
      city: contact.city.trim(),
      country: (contact.country || "NL").trim(),
      companyName: (contact.companyName || "").trim(),
      vatNumber: (contact.vatNumber || "").trim(),
      deliveryMethod: method,
      pickupStore: isPickup ? pickupStore.trim() : "",
      voucherCode: appliedCode,
      discountCents,
      giftcardCode: appliedGiftcard,
      giftcardCents,
      subtotalCents,
      shippingCents,
      totalCents,
    })
    .returning({ id: orders.id, orderNumber: orders.orderNumber });

  // Fase D — anti-oversell: claim de voorraad atomair vóór we kortingen verzilveren.
  // Afhalen reserveert in de gekozen winkel; standaard/express in de online-pool.
  // gross = beschikbaar (SRS + kassa − afgeleide web-reservering); de teller-gate
  // borgt dat twee gelijktijdige checkouts het laatste stuk niet allebei pakken.
  const skuList = [...new Set(lines.map((l) => l.sku).filter(Boolean))];
  const grossBySku = new Map<string, number>();
  if (isPickup) {
    const avail = await availableInStore(pickupStore.trim(), skuList);
    for (const s of skuList) grossBySku.set(s, avail.get(s) ?? 0);
  } else {
    // Online-pool: trek óók de actieve afhaal-holds in winkels af, zodat een
    // onbetaalde click&collect-reservering het laatste stuk niet alsnog online
    // laat verkopen (cross-pool anti-oversell). Web-pool-holds zitten al in de gate-teller.
    const [avail, storeHolds] = await Promise.all([availableForSkus(skuList), activeStoreHoldsBySku(skuList)]);
    for (const s of skuList) grossBySku.set(s, Math.max(0, (avail.get(s)?.online ?? 0) - (storeHolds.get(s.toLowerCase()) ?? 0)));
  }
  const reserveLoc = isPickup ? pickupStore.trim() : WEB_POOL;
  const requests: ReserveRequest[] = lines.map((l) => ({
    location: reserveLoc,
    stockKey: l.sku,
    qty: l.quantity,
    gross: grossBySku.get(l.sku) ?? 0,
  }));
  const reservation = await reserveOrderStock(order.id, requests);
  if (!reservation.ok) {
    // Niet leverbaar → order weer weg (nog geen voucher/cadeaubon verzilverd).
    await db.delete(orders).where(eq(orders.id, order.id));
    const failedLines = lines.filter(
      (l) => reservation.failed.includes(l.sku.toLowerCase()) || reservation.failed.includes(l.sku)
    );
    const titles = failedLines.map((l) => l.title).filter((v, i, a) => a.indexOf(v) === i);
    const skus = failedLines.map((l) => l.sku).filter((v, i, a) => a.indexOf(v) === i);
    throw new OutOfStockError(titles.length ? titles : ["een of meer artikelen"], skus);
  }

  // Order-regels EERST — zo heeft een order altijd z'n regels vóór we single-use
  // codes (voucher/cadeaubon) verzilveren. Faalt dit → holds vrij + order weg, zodat
  // er nooit een betaalbare order zonder regels (of een verzilverde-code-zonder-order)
  // achterblijft. (neon-http kent geen transactie, dus handmatige rollback.)
  try {
    await db.insert(orderLines).values(
      lines.map((l) => ({
        orderId: order.id,
        sku: l.sku,
        productHandle: l.productHandle,
        title: l.title,
        size: l.size,
        color: l.color,
        unitPriceCents: l.unitPriceCents,
        quantity: l.quantity,
        groupId: l.groupId ?? null,
        roleLabel: l.roleLabel ?? null,
      }))
    );
  } catch (e) {
    await releaseOrderHolds(order.id);
    await db.delete(orders).where(eq(orders.id, order.id));
    throw e;
  }

  if (appliedCode) await redeemVoucher(appliedCode);
  // Cadeaubon afboeken (idempotent per order; geeft het werkelijk afgeboekte terug).
  if (appliedGiftcard) await redeemGiftcard(appliedGiftcard, order.orderNumber, giftcardCents);

  return { id: order.id, orderNumber: order.orderNumber, accessToken, totalCents, subtotalCents, shippingCents, giftcardCents };
}

/**
 * Rondt een order af die volledig met een cadeaubon is betaald (totaal = 0):
 * geen Mollie nodig. Markeert betaald, stuurt de bevestiging en plant de
 * fulfilment — alles idempotent via een synthetische betaal-id.
 */
export async function finalizeGiftcardCoveredOrder(orderId: string): Promise<void> {
  const synthetic = `gift-${orderId}`;
  await attachMolliePayment(orderId, synthetic);
  await applyPaymentStatus(synthetic, "paid");
  await sendOrderConfirmationOnce(synthetic);
  await planAndPushFulfillmentOnce(synthetic);
}

/**
 * "Bestel voor klant" afgerekend AAN DE KASSA (contant/pin) i.p.v. via een
 * betaallink: de klant betaalde fysiek in de winkel (vastgelegd als kassa-verkoop,
 * omzet naar het filiaal). De order wordt hier betaald gemarkeerd + ingepland voor
 * fulfilment uit het bron-filiaal/magazijn — zonder Mollie. De synthetische ref
 * `register-…` maakt 'm herkenbaar (omzet zit al in de kassa-dagstaat → niet
 * dubbeltellen in web-omzet).
 */
export async function finalizeRegisterPaidOrder(orderId: string): Promise<void> {
  const synthetic = `register-${orderId}`;
  await attachMolliePayment(orderId, synthetic);
  await applyPaymentStatus(synthetic, "paid");
  await sendOrderConfirmationOnce(synthetic);
  await planAndPushFulfillmentOnce(synthetic);
}

/** Geeft de cadeaubon van een order terug wanneer de betaling mislukt/verloopt. */
export async function releaseOrderGiftcard(molliePaymentId: string): Promise<void> {
  const db = getDb();
  const [order] = await db
    .select({ giftcardCode: orders.giftcardCode, orderNumber: orders.orderNumber, giftcardCents: orders.giftcardCents })
    .from(orders)
    .where(eq(orders.molliePaymentId, molliePaymentId))
    .limit(1);
  if (order?.giftcardCode && order.giftcardCents > 0) {
    await releaseGiftcard(order.giftcardCode, order.orderNumber);
  }
}

export async function attachMolliePayment(orderId: string, molliePaymentId: string) {
  const db = getDb();
  await db
    .update(orders)
    .set({ molliePaymentId, paymentStatus: "open", updatedAt: sql`now()` })
    .where(eq(orders.id, orderId));
  // Betaling gestart → verleng de voorraad-hold tot een ruime backstop (24u), zodat
  // trage betaalmethoden (banktransfer) het laatste stuk niet tussentijds verliezen.
  // Definitieve vrijgave loopt via de webhook (betaald/ mislukt/ verlopen).
  await renewOrderHolds(orderId, 1440);
}

/** Mollie-status → order-status. Idempotent (webhook kan dubbel binnenkomen). */
export async function applyPaymentStatus(molliePaymentId: string, paymentStatus: string) {
  const db = getDb();
  const map: Record<string, string> = {
    paid: "paid",
    authorized: "paid",
    canceled: "canceled",
    expired: "expired",
    failed: "failed",
  };
  const orderStatus = map[paymentStatus];
  const set: Record<string, unknown> = { paymentStatus, updatedAt: sql`now()` };
  if (orderStatus) set.status = orderStatus;
  if (paymentStatus === "paid" || paymentStatus === "authorized") set.paidAt = sql`now()`;
  const updated = await db
    .update(orders)
    .set(set)
    .where(eq(orders.molliePaymentId, molliePaymentId))
    .returning({ id: orders.id });
  // Betaling mislukt/geannuleerd/verlopen → de voorraad-hold direct vrijgeven.
  if (updated.length && (orderStatus === "canceled" || orderStatus === "expired" || orderStatus === "failed")) {
    await releaseOrderHolds(updated[0].id);
  }
}

/**
 * Verstuurt de orderbevestiging precies één keer (idempotent t.o.v. dubbele
 * webhooks). Claimt eerst de mail via een conditionele UPDATE, daarna pas
 * versturen — zo wint bij een race maar één webhook-call.
 */
export async function sendOrderConfirmationOnce(molliePaymentId: string): Promise<void> {
  const db = getDb();
  const claimed = await db
    .update(orders)
    .set({ confirmationSentAt: sql`now()` })
    .where(
      and(
        eq(orders.molliePaymentId, molliePaymentId),
        eq(orders.status, "paid"),
        isNull(orders.confirmationSentAt)
      )
    )
    .returning({ id: orders.id });
  if (!claimed.length) return; // al verstuurd of (nog) niet betaald

  const orderId = claimed[0].id;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  // Spaarpunten bijschrijven voor een ingelogde klant (gast-orders krijgen ze bij
  // account-koppeling via claimGuestData). Idempotent + non-fataal — nooit de
  // bevestiging blokkeren.
  if (order?.customerId) {
    try {
      await creditOrderLoyalty(order.customerId, { id: order.id, totalCents: order.totalCents, status: String(order.status) });
    } catch (e) {
      console.warn("[order] punten bijschrijven mislukt:", e instanceof Error ? e.message : e);
    }
  }
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  const recs = await getOrderCrossSell(orderId, 3).catch(() => []);
  const ok = await sendOrderConfirmation(order, lines, recs);
  if (!ok) {
    // Niet verstuurd → claim terugdraaien zodat een volgende webhook het opnieuw probeert.
    await db.update(orders).set({ confirmationSentAt: null }).where(eq(orders.id, orderId));
  }
}

/**
 * Berekent het allocatieplan (welke filialen leveren wat) en pusht de
 * weborders naar SRS — precies één keer per order (idempotent t.o.v. dubbele
 * webhooks). Claimt eerst via een conditionele UPDATE op fulfillment_status.
 */
export async function planAndPushFulfillmentOnce(molliePaymentId: string): Promise<void> {
  const db = getDb();
  const claimed = await db
    .update(orders)
    .set({ fulfillmentStatus: "planning" })
    .where(
      and(
        eq(orders.molliePaymentId, molliePaymentId),
        eq(orders.status, "paid"),
        eq(orders.fulfillmentStatus, "pending")
      )
    )
    .returning({ id: orders.id });
  if (!claimed.length) return; // al gepland of (nog) niet betaald

  const orderId = claimed[0].id;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId));

  try {
    // Afhalen in winkel: geen allocatie/SRS — het plan is één zending op de
    // gekozen afhaalwinkel. Zo reserveert de core de voorraad dáár (kassa ziet 't)
    // en verschijnt de order als afhaalorder voor die winkel.
    if (order.deliveryMethod === "pickup") {
      const store = (order.pickupStore || "").trim() || "winkel";
      const pickupPlan = {
        shipments: [
          {
            branchId: "",
            store,
            isWarehouse: false,
            canDispatchToday: true,
            dispatchLabel: "Klaar om af te halen",
            dispatchInDays: 0,
            lines: lines.map((l) => ({ sku: l.sku, qty: l.quantity, title: l.title })),
            units: lines.reduce((n, l) => n + l.quantity, 0),
          },
        ],
        splitCount: 1,
        fullyAllocated: true,
        shortages: [] as { sku: string; qtyShort: number; title?: string }[],
        strategy: "single-source" as const,
        computedAt: new Date().toISOString(),
      };
      await db
        .update(orders)
        .set({ fulfillmentPlan: pickupPlan, fulfillmentStatus: "planned", updatedAt: sql`now()` })
        .where(eq(orders.id, orderId));
      await releaseOrderHolds(orderId); // plan staat → afgeleide reservering neemt over
      return;
    }

    const plan = await allocateOrder(
      lines.map((l) => ({ sku: l.sku, qty: l.quantity, title: l.title, groupId: l.groupId ?? undefined })),
      { country: order.country, postalCode: order.postalCode }
    );
    // SRS-push is afgeschaft (SRS = alleen WMS): we bewaren alléén het eigen
    // Neon-fulfilmentplan; dispatch loopt lokaal. Niet volledig toewijsbaar
    // (voorraad-tekort) → markeer voor handmatige review i.p.v. stil 'afgerond'.
    const status = plan.fullyAllocated ? "planned" : "review";
    if (!plan.fullyAllocated) {
      console.warn(
        "[fulfillment] order",
        order.orderNumber,
        "niet volledig toewijsbaar — shortages:",
        JSON.stringify(plan.shortages)
      );
    }
    await db
      .update(orders)
      .set({
        fulfillmentPlan: plan,
        fulfillmentStatus: status,
        updatedAt: sql`now()`,
      })
      .where(eq(orders.id, orderId));
    await releaseOrderHolds(orderId); // plan staat → afgeleide reservering neemt over
  } catch (e) {
    console.error("[fulfillment] plan/push faalde voor", order.orderNumber, e);
    // Terug naar 'pending' zodat een volgende webhook het opnieuw probeert.
    await db.update(orders).set({ fulfillmentStatus: "pending" }).where(eq(orders.id, orderId));
  }
}

/** Admin: zet de order-status en stuurt de klant een update (mail + WhatsApp). */
export async function updateOrderStatus(orderId: string, status: string): Promise<boolean> {
  const allowed = ["paid", "shipped", "ready_pickup", "delivered", "refunded", "canceled"];
  if (!allowed.includes(status)) return false;
  const db = getDb();
  const [order] = await db
    .update(orders)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(orders.id, orderId))
    .returning();
  if (!order) return false;
  const { notifyOrderStatus } = await import("@/lib/order-notify");
  await notifyOrderStatus(
    { orderNumber: order.orderNumber, email: order.email, firstName: order.firstName, phone: order.phone, accessToken: order.accessToken },
    status
  );
  return true;
}

/** Admin: recente orders voor het beheeroverzicht. */
export async function listRecentOrders(limit = 50) {
  const db = getDb();
  return db.select().from(orders).orderBy(sql`created_at desc`).limit(limit);
}

/** Admin: operationele orders die nog actie vragen (excl. geïmporteerde historie). */
export async function listOperationalOrders(limit = 40) {
  const db = getDb();
  return db
    .select()
    .from(orders)
    .where(sql`status in ('paid','open','shipped','ready_pickup') and fulfillment_status <> 'imported'`)
    .orderBy(sql`created_at desc`)
    .limit(limit);
}

export async function getOrderByNumber(orderNumber: string) {
  const db = getDb();
  const rows = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1);
  const order = rows[0];
  if (!order) return null;
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, order.id));
  return { order, lines };
}

/**
 * Order voor de bevestigingspagina — alléén zichtbaar met een geldig
 * access-token (gast) OF voor de ingelogde eigenaar. Voorkomt IDOR: besteldetails
 * (naam, e-mail, regels, bedragen) zijn persoonsgegevens en mogen niet op een
 * (deels voorspelbaar) ordernummer alleen opvraagbaar zijn.
 */
export async function getOrderForViewer(
  orderNumber: string,
  opts: { token?: string | null; customerId?: string | null }
) {
  const data = await getOrderByNumber(orderNumber);
  if (!data) return null;
  const tokenOk = tokenEquals(opts.token, data.order.accessToken);
  const ownerOk = !!opts.customerId && data.order.customerId === opts.customerId;
  return tokenOk || ownerOk ? data : null;
}

/**
 * "Bestel opnieuw": resolve de regels van een eerdere order naar de HUIDIGE
 * varianten (sku/prijs/voorraad op handle+maat). Alleen op voorraad zijnde regels
 * zijn toevoegbaar; de rest komt als "unavailable" terug. Viewer-beveiligd.
 */
export type ReorderLine = {
  sku: string; productHandle: string; title: string; size: string; color: string;
  priceCents: number; imageUrl: string; qty: number; hoofdgroep?: string;
};
export async function resolveReorder(
  orderNumber: string,
  opts: { token?: string | null; customerId?: string | null },
): Promise<{ addable: ReorderLine[]; unavailable: string[] } | null> {
  const data = await getOrderForViewer(orderNumber, opts);
  if (!data) return null;
  const db = getDb();
  const addable: ReorderLine[] = [];
  const unavailable: string[] = [];
  for (const l of data.lines) {
    if (!l.productHandle) { unavailable.push(l.title); continue; }
    const r = (
      await db.execute<{ sku: string; price_cents: number; stock_qty: number; hg: string | null; img: string | null }>(sql`
        select v.sku, v.price_cents, v.stock_qty, p.attributes->>'hoofdgroep_omschrijving' hg,
          (select pi.url from product_images pi where pi.product_id = p.id order by pi.position asc limit 1) img
        from products p join product_variants v on v.product_id = p.id
        where p.handle = ${l.productHandle} and p.status = 'active' and coalesce(v.size, '') = ${l.size || ""}
        limit 1`)
    ).rows[0];
    if (r && Number(r.stock_qty) > 0) {
      addable.push({
        sku: r.sku, productHandle: l.productHandle, title: l.title, size: l.size || "",
        color: l.color || "", priceCents: Number(r.price_cents) || 0, imageUrl: r.img || "",
        qty: Math.max(1, l.quantity), hoofdgroep: r.hg || undefined,
      });
    } else {
      unavailable.push(l.title + (l.size ? ` (maat ${l.size})` : ""));
    }
  }
  return { addable, unavailable };
}

/** Post-purchase extra's voor de bedankpagina: verzorgingstips + cross-sell. */
export async function getPostPurchase(
  handles: string[]
): Promise<{ careItems: CareItem[]; recommendations: ProductCardData[] }> {
  const uniq = [...new Set(handles.filter(Boolean))];
  if (!uniq.length) return { careItems: [], recommendations: [] };
  const db = getDb();
  const rows = await db.execute<{ id: string; hg: string; was: string; mat: string }>(sql`
    select id, attributes->>'hoofdgroep_omschrijving' hg, attributes->>'wasvoorschrift' was, attributes->>'materiaal' mat
    from products where handle in (${sql.join(uniq.map((h) => sql`${h}`), sql`, `)})
  `);
  const seen = new Set<string>();
  const careItems: CareItem[] = [];
  for (const r of rows.rows) {
    for (const ci of parseCare(r.was, { hoofdgroep_omschrijving: r.hg, materiaal: r.mat })) {
      if (!seen.has(ci.key)) {
        seen.add(ci.key);
        careItems.push(ci);
      }
    }
  }
  const hg = rows.rows[0]?.hg || "";
  const excludeId = rows.rows[0]?.id || "";
  const recommendations = hg ? await getRecommendations(hg, excludeId, 4) : [];
  return { careItems: careItems.slice(0, 6), recommendations };
}
