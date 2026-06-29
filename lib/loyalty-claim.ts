/**
 * lib/loyalty-claim.ts
 *
 * Anonieme-punten-claim-engine. Een kassabon (zonder account) of een gast-weborder
 * levert spaarpunten op; die worden bijgeschreven zodra de klant een account heeft.
 * Geclaimde punten landen in het ACCOUNT-grootboek (loyaltyEvents in Neon) — de
 * bron-van-waarheid voor het account. Idempotent op refType+refId, dus dubbel
 * claimen (dubbelklik, opnieuw inloggen) schrijft nooit dubbel bij.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customers, loyaltyEvents } from "@/db/schema";
import { getPosSaleCore } from "@/lib/pos-sales-core";
import { verifyReceiptToken, receiptSecretConfigured } from "@/lib/receipt-token";
import { getSettings } from "@/lib/settings";

const POINTS_PER_EURO = 1; // pilot — zelfde regel als de kassa (pointsForAmount)

/** 1 punt per hele euro. */
export function pointsForCents(cents: number): number {
  return Math.max(0, Math.floor((Number(cents) || 0) / 100)) * POINTS_PER_EURO;
}

export type ClaimResult = {
  ok: boolean;
  points?: number;
  alreadyClaimed?: boolean;
  balance?: number;
  error?: string;
};

/** Som van het grootboek = de waarheid voor het saldo (zoals de accountpagina). */
async function ledgerBalance(customerId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${loyaltyEvents.points}), 0)::int` })
    .from(loyaltyEvents)
    .where(eq(loyaltyEvents.customerId, customerId));
  return row?.total || 0;
}

/** Dagen tot vesting → besteedbaar-vanaf-datum, gerekend vanaf een basisdatum
 *  (betaal-/bon-datum). Instelbaar via settings (loyaltyConfig.vestingDays). */
async function vestsAtFrom(base: Date | null | undefined): Promise<Date> {
  const days = (await getSettings()).loyaltyConfig?.vestingDays ?? 21;
  const from = base instanceof Date && !isNaN(base.getTime()) ? base : new Date();
  return new Date(from.getTime() + Math.max(0, days) * 86400000);
}

/** Besteedbaar saldo = punten die al gevest zijn (vestsAt NULL of in het verleden). */
export async function redeemableBalance(customerId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${loyaltyEvents.points}), 0)::int` })
    .from(loyaltyEvents)
    .where(and(eq(loyaltyEvents.customerId, customerId), sql`(${loyaltyEvents.vestsAt} is null or ${loyaltyEvents.vestsAt} <= now())`));
  return row?.total || 0;
}

/** Punten "in behandeling": vestsAt in de toekomst → nog niet besteedbaar. */
export async function pendingBalance(customerId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${loyaltyEvents.points}), 0)::int` })
    .from(loyaltyEvents)
    .where(and(eq(loyaltyEvents.customerId, customerId), sql`${loyaltyEvents.vestsAt} > now()`));
  return row?.total || 0;
}

/**
 * Schrijf punten één keer bij op een account (idempotent op refType+refId). De
 * aanroeper heeft het token/eigendom al geverifieerd.
 *
 * Idempotentie is dubbel geborgd: een snelle bestaat-al-check én een unieke index
 * op (ref_type, ref_id) met onConflictDoNothing, zodat ook twee gelijktijdige
 * claims (dubbelklik, twee tabs, StrictMode) nooit dubbel bijschrijven. Het saldo
 * (cache + return) komt uit de som van het grootboek, dus cache en ledger kunnen
 * niet uit elkaar lopen.
 */
async function creditOnce(customerId: string, points: number, reason: string, refType: string, refId: string, vestsAt: Date | null): Promise<ClaimResult> {
  if (points <= 0) return { ok: false, error: "Geen punten te verzilveren." };
  const db = getDb();
  const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!c) return { ok: false, error: "Account niet gevonden." };

  const existing = await db
    .select({ id: loyaltyEvents.id })
    .from(loyaltyEvents)
    .where(and(eq(loyaltyEvents.refType, refType), eq(loyaltyEvents.refId, refId)))
    .limit(1);
  if (existing[0]) return { ok: true, alreadyClaimed: true, points: 0, balance: await ledgerBalance(customerId) };

  const inserted = await db
    .insert(loyaltyEvents)
    .values({ customerId, points, reason, refType, refId, vestsAt })
    .onConflictDoNothing()
    .returning({ id: loyaltyEvents.id });
  if (inserted.length) {
    // Cache atomisch bijwerken (geen read-modify-write) — synct sowieso met de ledger-som.
    await db
      .update(customers)
      .set({ loyaltyPoints: sql`${customers.loyaltyPoints} + ${points}`, updatedAt: new Date() })
      .where(eq(customers.id, customerId));
  }
  return { ok: true, points: inserted.length ? points : 0, alreadyClaimed: !inserted.length, balance: await ledgerBalance(customerId) };
}

/** Verzilver de spaarpunten van een ANONIEME kassabon naar een account. */
export async function claimReceiptPoints(input: { saleId: string; token: string; customerId: string }): Promise<ClaimResult> {
  const saleId = String(input.saleId || "").trim();
  const customerId = String(input.customerId || "").trim();
  if (!saleId || !customerId) return { ok: false, error: "Onvolledig verzoek." };
  // Fail closed: zonder een eigen bon-secret is het token te vervalsen → geen punten.
  if (!receiptSecretConfigured()) return { ok: false, error: "Punten verzilveren is nog niet ingeschakeld." };
  if (!verifyReceiptToken(saleId, input.token)) return { ok: false, error: "Ongeldige bon-link." };
  const sale = await getPosSaleCore(saleId);
  if (!sale) return { ok: false, error: "Bon niet gevonden." };
  const s = sale as { cancelled?: boolean; customerId?: string; total?: number };
  if (s.cancelled) return { ok: false, error: "Deze bon is geannuleerd." };
  if (String(s.customerId || "")) return { ok: false, error: "Deze bon hoort al bij een klant." };
  const points = pointsForCents(Math.round((Number(s.total) || 0) * 100));
  const saleDate = (sale as { createdAt?: string }).createdAt ? new Date(String((sale as { createdAt?: string }).createdAt)) : null;
  return creditOnce(customerId, points, "Kassabon gekoppeld", "pos_receipt", saleId, await vestsAtFrom(saleDate));
}

/**
 * Schrijf de punten van een (zojuist aan een account gekoppelde) betaalde weborder
 * bij — idempotent. Gebruikt bij claimGuestData zodat gast-orders bij account-
 * aanmaak automatisch punten opleveren.
 */
export async function creditOrderLoyalty(
  customerId: string,
  order: { id: string; totalCents: number; status: string; paidAt?: Date | null; createdAt?: Date | null },
): Promise<ClaimResult> {
  const paidish = ["paid", "shipped", "ready_pickup", "delivered"];
  if (!paidish.includes(String(order.status))) return { ok: false, error: "Order nog niet betaald." };
  const points = pointsForCents(order.totalCents);
  // Vesting vanaf de betaaldatum (betaald + N dagen); val bij ontbrekende paidAt terug
  // op de orderdatum (niet nu) zodat oude/geïmporteerde orders niet onterecht weer
  // een vol venster "in behandeling" gaan.
  return creditOnce(customerId, points, "Weborder gekoppeld", "web_order", order.id, await vestsAtFrom(order.paidAt ?? order.createdAt ?? null));
}

/**
 * Draai (een deel van) de order-punten terug bij een retour — idempotent per retour
 * (refType 'loyalty_reversal', refId = retour-id). De punten staan normaal nog "in
 * behandeling" (binnen het vesting-venster), dus dit geeft geen negatief saldo.
 * Reverseert pointsForCents(itemsCents) — de waarde van de geretourneerde artikelen.
 */
export async function reverseOrderLoyalty(customerId: string, orderId: string, basisCents: number, returnId: string): Promise<void> {
  const cid = String(customerId || "").trim();
  const oid = String(orderId || "").trim();
  const rid = String(returnId || "").trim();
  if (!cid || !oid || !rid) return;
  const requested = pointsForCents(basisCents);
  if (requested <= 0) return;
  const db = getDb();
  const refKey = `${oid}:${rid}`; // per order + per retour → idempotent én optelbaar per order
  const dup = await db
    .select({ id: loyaltyEvents.id })
    .from(loyaltyEvents)
    .where(and(eq(loyaltyEvents.refType, "loyalty_reversal"), eq(loyaltyEvents.refId, refKey)))
    .limit(1);
  if (dup[0]) return;
  // Nooit méér terugdraaien dan voor déze order is gecrediteerd (na eerdere reversals).
  // Lost de grondslag-mismatch op: credit = pointsForCents(totalCents, net), reversal-
  // basis = itemsCents (bruto) → cap voorkomt een negatief saldo dat in andere orders bijt.
  const [cr] = await db
    .select({ total: sql<number>`coalesce(sum(${loyaltyEvents.points}), 0)::int` })
    .from(loyaltyEvents)
    .where(and(eq(loyaltyEvents.customerId, cid), eq(loyaltyEvents.refType, "web_order"), eq(loyaltyEvents.refId, oid)));
  const credited = Math.max(0, cr?.total || 0);
  const [rv] = await db
    .select({ total: sql<number>`coalesce(sum(${loyaltyEvents.points}), 0)::int` })
    .from(loyaltyEvents)
    .where(and(eq(loyaltyEvents.customerId, cid), eq(loyaltyEvents.refType, "loyalty_reversal"), sql`${loyaltyEvents.refId} like ${oid + ":%"}`));
  const alreadyReversed = Math.max(0, -(rv?.total || 0));
  const toReverse = Math.min(requested, Math.max(0, credited - alreadyReversed));
  if (toReverse <= 0) return;
  const inserted = await db
    .insert(loyaltyEvents)
    .values({ customerId: cid, points: -toReverse, reason: "Retour", refType: "loyalty_reversal", refId: refKey, vestsAt: null })
    .onConflictDoNothing()
    .returning({ id: loyaltyEvents.id });
  if (inserted.length) {
    await db
      .update(customers)
      .set({ loyaltyPoints: sql`greatest(0, ${customers.loyaltyPoints} - ${toReverse})`, updatedAt: new Date() })
      .where(eq(customers.id, cid));
  }
}
