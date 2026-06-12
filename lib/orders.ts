import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, orderLines, products, productVariants } from "@/db/schema";

/**
 * Order-logica (commerce-core). Prijzen worden ALTIJD server-side uit de DB
 * gehaald — nooit het client-bedrag vertrouwen. Bedragen in centen.
 */

const FREE_SHIPPING_CENTS = 5000; // €50
const SHIPPING_CENTS = 495; // €4,95 onder de drempel

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
  totalCents: number;
  subtotalCents: number;
  shippingCents: number;
};

export async function createOrder(
  contact: CheckoutContact,
  items: CheckoutItem[]
): Promise<CreatedOrder> {
  const db = getDb();
  const lines = await resolveLines(items);
  if (!lines.length) throw new Error("Geen geldige producten in de bestelling.");

  const subtotalCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const shippingCents = subtotalCents >= FREE_SHIPPING_CENTS ? 0 : SHIPPING_CENTS;
  const totalCents = subtotalCents + shippingCents;
  const orderNumber = generateOrderNumber();

  const [order] = await db
    .insert(orders)
    .values({
      orderNumber,
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
      subtotalCents,
      shippingCents,
      totalCents,
    })
    .returning({ id: orders.id, orderNumber: orders.orderNumber });

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

  return { id: order.id, orderNumber: order.orderNumber, totalCents, subtotalCents, shippingCents };
}

export async function attachMolliePayment(orderId: string, molliePaymentId: string) {
  const db = getDb();
  await db
    .update(orders)
    .set({ molliePaymentId, paymentStatus: "open", updatedAt: sql`now()` })
    .where(eq(orders.id, orderId));
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
  await db.update(orders).set(set).where(eq(orders.molliePaymentId, molliePaymentId));
}

export async function getOrderByNumber(orderNumber: string) {
  const db = getDb();
  const rows = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1);
  const order = rows[0];
  if (!order) return null;
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, order.id));
  return { order, lines };
}
