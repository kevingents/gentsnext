import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { getDb } from "@/db";
import { reservations } from "@/db/schema";
import { reserveOrderStock, releaseOrderHolds } from "@/lib/store-reserve";
import { availableInStore } from "@/lib/store-core";
import { createOrder, finalizeRegisterPaidOrder, type CheckoutContact, type CheckoutItem } from "@/lib/orders";
import { getReservationHoldDays } from "@/lib/reservation-config";

/**
 * Reserveringen — gents.nl-native (SRS = WMS, klanten in gents.nl). Een reservering
 * houdt voorraad HARD vast in de winkel via het anti-oversell-primitief
 * (lib/store-reserve, ref "RES-<id>", 7-daagse TTL) en hangt aan een gents.nl-klant.
 * Géén SRS-push. Afrekenen → converteert naar een betaalde afhaalorder (aparte stap).
 */

// Hold-/geldigheidsduur is instelbaar via de ReserveringConfig-kaart → zie
// getReservationHoldDays() (default 7 dagen).
// web_stock_holds.order_id is een uuid-kolom (geen FK) — de reservering-uuid zelf
// is de hold-sleutel. Een hold = een hold; anti-oversell telt 'm correct mee.
export const reservationHoldRef = (id: string) => id;
const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

export type ReservationLine = { stockKey: string; sku?: string; barcode?: string; title?: string; size?: string; color?: string; imageUrl?: string; qty: number; priceCents?: number };
type CleanLine = Required<Pick<ReservationLine, "stockKey" | "sku" | "barcode" | "title" | "size" | "color" | "imageUrl" | "qty" | "priceCents">>;

function cleanLines(lines: ReservationLine[]): CleanLine[] {
  return (lines || [])
    .filter((l) => l && (l.stockKey || l.barcode || l.sku) && Number(l.qty) > 0)
    .map((l) => ({
      stockKey: lower(l.barcode || l.stockKey || l.sku),
      sku: l.sku || "", barcode: l.barcode || "", title: l.title || "", size: l.size || "", color: l.color || "", imageUrl: l.imageUrl || "",
      qty: Math.max(1, Math.round(Number(l.qty) || 1)), priceCents: Math.max(0, Math.round(Number(l.priceCents) || 0)),
    }));
}

export async function createReservation(input: {
  location: string;
  customer: { customerId?: string; email?: string; name?: string; phone?: string };
  lines: ReservationLine[];
  reason?: string; note?: string; createdBy?: string;
}): Promise<{ ok: boolean; reservation?: typeof reservations.$inferSelect; failed?: string[]; error?: string }> {
  const db = getDb();
  const location = String(input.location || "").trim();
  if (!location) return { ok: false, error: "Winkel vereist." };
  const lines = cleanLines(input.lines);
  if (!lines.length) return { ok: false, error: "Geen artikelen." };

  // Netto beschikbaar per stockKey in deze winkel = gross voor de hold-gate.
  const keys = [...new Set(lines.map((l) => l.stockKey))];
  const avail = await availableInStore(location, keys);

  const holdTtlMin = (await getReservationHoldDays()) * 24 * 60; // instelbaar (default 7 dagen)
  const validUntil = new Date(Date.now() + holdTtlMin * 60_000);
  const payToken = randomBytes(24).toString("base64url");

  const [row] = await db.insert(reservations).values({
    location,
    customerId: input.customer.customerId || "",
    customerEmail: lower(input.customer.email),
    customerName: input.customer.name || "",
    customerPhone: input.customer.phone || "",
    reason: input.reason || "", note: input.note || "",
    lines, validUntil, payToken, createdBy: input.createdBy || "",
  }).returning();

  // HARDE hold (anti-oversell): claim de stukken in de winkel voor 7 dagen.
  const requests = lines.map((l) => ({ location, stockKey: l.stockKey, qty: l.qty, gross: Math.max(0, Number(avail.get(l.stockKey) || 0)) }));
  const hold = await reserveOrderStock(reservationHoldRef(row.id), requests, holdTtlMin);
  if (!hold.ok) {
    await db.update(reservations).set({ status: "cancelled", updatedAt: new Date() }).where(eq(reservations.id, row.id));
    return { ok: false, failed: hold.failed, error: "Niet genoeg voorraad om vast te houden." };
  }
  return { ok: true, reservation: row };
}

/** Voor supply-chain: alle reserveringen (alle winkels) met de gegeven statussen. */
export async function listAllReservations(statuses: string[] = ["open"], limit = 300) {
  const db = getDb();
  const q = db.select().from(reservations);
  const rows = statuses.length
    ? await q.where(inArray(reservations.status, statuses)).orderBy(desc(reservations.createdAt)).limit(limit)
    : await q.orderBy(desc(reservations.createdAt)).limit(limit);
  return rows;
}

/**
 * Fysiek apart-gehouden aantal per stockKey in een winkel = de actieve
 * voorraad-holds daar (reserveringen + onbetaalde click&collect). Voor de
 * inventarisatie: deze stuks liggen apart en moeten meegeteld worden — de zeroing
 * mag ze niet als "ontbrekend" wegboeken.
 */
export async function heldQtyByStockKey(location: string, keys?: string[]): Promise<Map<string, number>> {
  const db = getDb();
  const loc = lower(location);
  const out = new Map<string, number>();
  if (!loc) return out;
  const clean = keys && keys.length ? [...new Set(keys.map(lower).filter(Boolean))] : null;
  if (clean && !clean.length) return out;
  const keyFilter = clean ? sql` and stock_key in (${sql.join(clean.map((k) => sql`${k}`), sql`, `)})` : sql``;
  const rows = await db.execute<{ stock_key: string; qty: number }>(sql`
    select stock_key, sum(qty)::int as qty
    from web_stock_holds
    where location = ${loc} and expires_at > now()${keyFilter}
    group by stock_key`);
  for (const r of rows.rows) out.set(r.stock_key, Math.max(0, Number(r.qty) || 0));
  return out;
}

export async function getReservation(id: string) {
  const db = getDb();
  const [r] = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
  return r || null;
}

export async function getReservationByPayToken(token: string) {
  const t = String(token || "").trim();
  if (!t) return null;
  const db = getDb();
  const [r] = await db.select().from(reservations).where(eq(reservations.payToken, t)).limit(1);
  return r || null;
}

export async function listReservations(location: string, status?: string, limit = 100) {
  const db = getDb();
  const cond = status
    ? and(eq(reservations.location, location), eq(reservations.status, status))
    : eq(reservations.location, location);
  return db.select().from(reservations).where(cond).orderBy(desc(reservations.createdAt)).limit(limit);
}

export async function cancelReservation(id: string, actor?: string) {
  const db = getDb();
  const [r] = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
  if (!r) return { ok: false, error: "Niet gevonden." };
  await releaseOrderHolds(reservationHoldRef(id)); // geef de vastgehouden voorraad vrij
  const [u] = await db.update(reservations).set({ status: "cancelled", updatedAt: new Date(), note: actor ? `${r.note}`.trim() : r.note }).where(eq(reservations.id, id)).returning();
  return { ok: true, reservation: u };
}

export async function markPickedUp(id: string) {
  const db = getDb();
  await releaseOrderHolds(reservationHoldRef(id));
  const [u] = await db.update(reservations).set({ status: "picked_up", updatedAt: new Date() }).where(eq(reservations.id, id)).returning();
  return u || null;
}

/** Markeer verlopen open reserveringen (validUntil voorbij) → 'expired'; de TTL-sweep
 *  geeft de hold sowieso vrij, hier ook expliciet vrijgeven + status zetten. */
export async function expireReservations() {
  const db = getDb();
  const rows = await db.select({ id: reservations.id }).from(reservations)
    .where(and(eq(reservations.status, "open"), eq(reservations.paid, false), lt(reservations.validUntil, new Date())));
  let expired = 0;
  for (const r of rows) {
    await releaseOrderHolds(reservationHoldRef(r.id));
    await db.update(reservations).set({ status: "expired", updatedAt: new Date() }).where(eq(reservations.id, r.id));
    expired++;
  }
  return { expired };
}

/** Afgerekend → converteer naar een betaalde afhaalorder: zet de reservering op
 *  'converted' + paid, koppel het ordernummer, maak onbeperkt (validUntil null).
 *  De RES-hold wordt vrijgegeven (de order houdt nu vast). */
export async function markReservationConverted(id: string, orderId: string) {
  const db = getDb();
  await releaseOrderHolds(reservationHoldRef(id));
  const [u] = await db.update(reservations)
    .set({ status: "converted", paid: true, validUntil: null, convertedOrderId: String(orderId || ""), updatedAt: new Date() })
    .where(eq(reservations.id, id)).returning();
  return u || null;
}

/** Te betalen bedrag (cent) van een reservering = som van de regels. */
export function reservationAmountCents(lines: ReservationLine[]): number {
  return (Array.isArray(lines) ? lines : []).reduce((n, l) => n + (Number(l.priceCents) || 0) * Math.max(1, Number(l.qty) || 1), 0);
}

/**
 * Online afgerekend (Mollie betaald) → maak er een BETAALDE afhaalorder van.
 * Idempotent. De RES-hold valt vrij en de order (pickup in dezelfde winkel) houdt
 * de voorraad vast — het stuk zit in de SRS-baseline, dus de order-hold lukt.
 * `finalizeRegisterPaidOrder` markeert betaald + plant de fulfilment (geen Mollie;
 * de betaling liep al via de reserverings-betaallink).
 */
export async function convertReservationToOrder(reservationId: string): Promise<{ ok: boolean; orderNumber?: string; alreadyDone?: boolean; error?: string }> {
  const db = getDb();
  const [r] = await db.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
  if (!r) return { ok: false, error: "Reservering niet gevonden." };
  if (r.status === "converted" || r.convertedOrderId) return { ok: true, orderNumber: r.convertedOrderId, alreadyDone: true };
  const lines = (Array.isArray(r.lines) ? r.lines : []) as ReservationLine[];
  if (!lines.length) return { ok: false, error: "Reservering zonder regels." };

  // Atomaire claim (compare-and-swap op de status): twee overlappende Mollie-webhooks
  // voor dezelfde reservering lezen beide status "open"; de UPDATE flipt maar één keer
  // naar "converting" (de tweede matcht 0 rijen). Zo maakt nooit meer dan één webhook
  // een betaalde afhaalorder. neon-http kent geen transacties → een conditionele UPDATE
  // is hier de atomaire primitief.
  const prevStatus = r.status;
  const claimed = await db
    .update(reservations)
    .set({ status: "converting", updatedAt: new Date() })
    .where(and(eq(reservations.id, reservationId), eq(reservations.status, prevStatus), eq(reservations.convertedOrderId, "")))
    .returning({ id: reservations.id });
  if (!claimed.length) {
    // Een parallelle call won de claim → geef de (mogelijk net gezette) conversie terug.
    const [again] = await db
      .select({ convertedOrderId: reservations.convertedOrderId })
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .limit(1);
    return { ok: true, orderNumber: again?.convertedOrderId || undefined, alreadyDone: true };
  }

  await releaseOrderHolds(reservationHoldRef(reservationId)); // RES-hold vrij → order kan claimen
  const contact: CheckoutContact = {
    email: r.customerEmail || "", firstName: r.customerName || "Klant", lastName: "", phone: r.customerPhone || "",
    street: "", houseNumber: "", postalCode: "", city: "", country: "NL",
  };
  const items: CheckoutItem[] = lines.map((l) => ({ sku: l.sku || "", qty: Math.max(1, Number(l.qty) || 1) }));

  let order;
  try {
    order = await createOrder(contact, items, "pickup", "", "", r.location);
  } catch (e) {
    // Order aanmaken faalde → claim teruggeven zodat een volgende webhook/retry het
    // opnieuw kan proberen (anders blijft de reservering voorgoed op "converting" staan).
    await db.update(reservations).set({ status: prevStatus, updatedAt: new Date() }).where(eq(reservations.id, reservationId)).catch(() => {});
    return { ok: false, error: e instanceof Error ? e.message : "Order kon niet aangemaakt worden." };
  }
  await finalizeRegisterPaidOrder(order.id);
  await markReservationConverted(reservationId, order.orderNumber);
  return { ok: true, orderNumber: order.orderNumber };
}
