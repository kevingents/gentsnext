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
async function creditOnce(customerId: string, points: number, reason: string, refType: string, refId: string): Promise<ClaimResult> {
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
    .values({ customerId, points, reason, refType, refId })
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
  return creditOnce(customerId, points, "Kassabon gekoppeld", "pos_receipt", saleId);
}

/**
 * Schrijf de punten van een (zojuist aan een account gekoppelde) betaalde weborder
 * bij — idempotent. Gebruikt bij claimGuestData zodat gast-orders bij account-
 * aanmaak automatisch punten opleveren.
 */
export async function creditOrderLoyalty(
  customerId: string,
  order: { id: string; totalCents: number; status: string },
): Promise<ClaimResult> {
  const paidish = ["paid", "shipped", "ready_pickup", "delivered"];
  if (!paidish.includes(String(order.status))) return { ok: false, error: "Order nog niet betaald." };
  const points = pointsForCents(order.totalCents);
  return creditOnce(customerId, points, "Weborder gekoppeld", "web_order", order.id);
}
