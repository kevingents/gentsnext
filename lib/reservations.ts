import { and, desc, eq, lt, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { getDb } from "@/db";
import { reservations } from "@/db/schema";
import { reserveOrderStock, releaseOrderHolds } from "@/lib/store-reserve";
import { availableInStore } from "@/lib/store-core";

/**
 * Reserveringen — gents.nl-native (SRS = WMS, klanten in gents.nl). Een reservering
 * houdt voorraad HARD vast in de winkel via het anti-oversell-primitief
 * (lib/store-reserve, ref "RES-<id>", 7-daagse TTL) en hangt aan een gents.nl-klant.
 * Géén SRS-push. Afrekenen → converteert naar een betaalde afhaalorder (aparte stap).
 */

const HOLD_DAYS = 7;
const HOLD_TTL_MIN = HOLD_DAYS * 24 * 60; // 10080
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

  const validUntil = new Date(Date.now() + HOLD_TTL_MIN * 60_000);
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
  const hold = await reserveOrderStock(reservationHoldRef(row.id), requests, HOLD_TTL_MIN);
  if (!hold.ok) {
    await db.update(reservations).set({ status: "cancelled", updatedAt: new Date() }).where(eq(reservations.id, row.id));
    return { ok: false, failed: hold.failed, error: "Niet genoeg voorraad om vast te houden." };
  }
  return { ok: true, reservation: row };
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
