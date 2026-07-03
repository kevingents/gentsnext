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
import { customers, loyaltyEvents, vouchers } from "@/db/schema";
import { getPosSaleCore } from "@/lib/pos-sales-core";
import { verifyReceiptToken, receiptSecretConfigured } from "@/lib/receipt-token";
import { getSettings } from "@/lib/settings";
import { formatEuro } from "@/lib/format";

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

/** Unieke inwissel-voucher-code (PUNT-XXXXXXXX, zonder verwarrende tekens). */
function randVoucherCode(): string {
  const ab = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += ab[Math.floor(Math.random() * ab.length)];
  return "PUNT-" + s;
}

export type RedeemResult = { ok: boolean; code?: string; valueCents?: number; points?: number; newBalance?: number; error?: string };

/**
 * Wissel spaarpunten in voor een GENTS-tegoedbon — VOLLEDIG Neon-native, geen SRS.
 * Vervangt de oude SRS CreateFromLoyaltyPoints-flow. Boekt de punten af via een negatief
 * loyalty_events-event én maakt een vaste-bedrag-voucher aan (aan deze klant). Rekent op
 * het BESTEEDBARE (gevest) saldo; koers/minimum/stap/looptijd uit de settings-store.
 */
export async function redeemPointsForVoucher(customerId: string, points: number): Promise<RedeemResult> {
  const pts = Math.floor(Number(points) || 0);
  if (!customerId) return { ok: false, error: "Geen account." };

  const lc = (await getSettings()).loyaltyConfig as {
    redeemCentsPerPoint?: number; redeemMinPoints?: number; redeemStepPoints?: number; redeemVoucherDays?: number;
  };
  const centsPerPoint = Number(lc?.redeemCentsPerPoint) > 0 ? Number(lc.redeemCentsPerPoint) : 5;
  const minPoints = Number(lc?.redeemMinPoints) > 0 ? Number(lc.redeemMinPoints) : 500;
  const stepPoints = lc?.redeemStepPoints == null ? 500 : Math.max(0, Number(lc.redeemStepPoints));
  const validDays = Number(lc?.redeemVoucherDays) > 0 ? Number(lc.redeemVoucherDays) : 365;

  if (pts < minPoints) return { ok: false, error: `Je kunt vanaf ${minPoints} punten inwisselen.` };
  if (stepPoints > 0 && pts % stepPoints !== 0) return { ok: false, error: `Inwisselen per ${stepPoints} punten.` };

  const redeemable = await redeemableBalance(customerId);
  if (pts > redeemable) return { ok: false, error: `Je hebt ${redeemable} besteedbare punten.` };

  const valueCents = pts * centsPerPoint;
  const db = getDb();

  // Niet-geveste (nog "in behandeling") punten = totaal-cache − besteedbaar. De atomische guard
  // borgt dat het totaal ná de afboeking NOOIT onder dit niet-geveste bedrag zakt — anders
  // konden gelijktijdige inwisselingen samen nog-niet-geveste punten opmaken (de oude guard
  // checkte alleen ≥ 0 op het totaal, niet op het geveste saldo).
  const [cur] = await db.select({ total: customers.loyaltyPoints }).from(customers).where(eq(customers.id, customerId)).limit(1);
  const nonVested = Math.max(0, (Number(cur?.total) || 0) - redeemable);
  const dec = await db
    .update(customers)
    .set({ loyaltyPoints: sql`${customers.loyaltyPoints} - ${pts}` })
    .where(and(eq(customers.id, customerId), sql`${customers.loyaltyPoints} - ${pts} >= ${nonVested}`))
    .returning({ balance: customers.loyaltyPoints });
  if (!dec.length) return { ok: false, error: "Onvoldoende besteedbare punten." };

  // Saldo is geclaimd. Bij een fout hierna: de decrement ÉN het zojuist ingeboekte negatieve
  // ledger-event terugdraaien (neon-http = geen transactie). Anders bleef een wees-'redeem'-
  // event staan → de klant verliest besteedbare punten in het grootboek zonder bon.
  const code = randVoucherCode();
  let eventId: string | undefined;
  try {
    const [ev] = await db.insert(loyaltyEvents).values({
      customerId,
      points: -pts,
      reason: `Ingewisseld voor tegoedbon ${code} (${formatEuro(valueCents)})`,
      refType: "redeem",
      refId: code,
    }).returning({ id: loyaltyEvents.id });
    eventId = ev?.id;
    await db.insert(vouchers).values({
      code,
      customerId,
      description: `Ingewisseld: ${pts} spaarpunten`,
      kind: "amount",
      valueCents,
      status: "active",
      singleUse: true,
      expiresAt: new Date(Date.now() + validDays * 86400000),
    });
    return { ok: true, code, valueCents, points: pts, newBalance: Number(dec[0].balance) || 0 };
  } catch {
    // Cache terug + het negatieve ledger-event verwijderen → cache én grootboek blijven
    // consistent (geen wees-event, geen verloren besteedbare punten).
    await db
      .update(customers)
      .set({ loyaltyPoints: sql`${customers.loyaltyPoints} + ${pts}` })
      .where(eq(customers.id, customerId))
      .catch(() => {});
    if (eventId) await db.delete(loyaltyEvents).where(eq(loyaltyEvents.id, eventId)).catch(() => {});
    return { ok: false, error: "Inwisselen mislukte, probeer het opnieuw." };
  }
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
  // Alleen weigeren als de bon bij een ÁNDERE klant hoort. Hoort 'ie al bij DEZE klant
  // (kassa-verkoop op naam), dan mag die z'n bon-punten alsnog in Neon claimen — creditOnce
  // is idempotent op (customerId, 'pos_receipt', saleId), dus nooit dubbel.
  if (String(s.customerId || "") && String(s.customerId) !== customerId) {
    return { ok: false, error: "Deze bon hoort bij een andere klant." };
  }
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
