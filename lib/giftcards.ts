import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { giftcards, giftcardTransactions } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { sendGiftcardEmail } from "@/lib/email";

/**
 * Cadeaubonnen (giftcards) — SALDO-gebaseerd betaalmiddel (geen korting).
 *
 *  Kopen:      purchaseGiftcard() maakt een 'pending' bon → na Mollie-betaling
 *              activeert applyGiftcardPaymentStatus() 'm (saldo = bedrag) en
 *              mailt de code (idempotent t.o.v. dubbele webhooks).
 *  Verzilveren: validateGiftcard() bij de checkout, redeemGiftcard() boekt af
 *              (idempotent per order, nooit onder 0). Mislukt de betaling →
 *              releaseGiftcard() boekt het bedrag terug.
 */

// Leesbare, onvoorspelbare code: GIFT-XXXX-XXXX (geen I/O/0/1 → minder fouten).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(): string {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `GIFT-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

const norm = (c: string) => c.trim().toUpperCase().replace(/\s+/g, "");

export type Giftcard = typeof giftcards.$inferSelect;

export async function getGiftcardByCode(code: string): Promise<Giftcard | null> {
  const db = getDb();
  const rows = await db.select().from(giftcards).where(eq(giftcards.code, norm(code))).limit(1);
  return rows[0] ?? null;
}

export type GiftcardValidation = {
  valid: boolean;
  code: string;
  balanceCents: number;
  /** Hoeveel van dit order de bon dekt (min van saldo en orderbedrag). */
  applyCents: number;
  error?: string;
};

/** Validatie bij het verzilveren. amountCents = het orderbedrag dat te dekken is. */
export async function validateGiftcard(rawCode: string, amountCents: number): Promise<GiftcardValidation> {
  const code = norm(rawCode);
  const empty = { valid: false as const, code, balanceCents: 0, applyCents: 0 };
  if (!code) return { ...empty, error: "Vul een code in." };
  const g = await getGiftcardByCode(code);
  if (!g || g.status === "pending" || g.status === "cancelled") {
    return { ...empty, error: "Onbekende of niet-actieve cadeaubon." };
  }
  if (g.balanceCents <= 0) return { ...empty, error: "Deze cadeaubon is al volledig gebruikt." };
  if (g.expiresAt && g.expiresAt.getTime() < Date.now()) return { ...empty, error: "Deze cadeaubon is verlopen." };
  const applyCents = Math.max(0, Math.min(g.balanceCents, Math.max(0, Math.floor(amountCents))));
  return { valid: true, code, balanceCents: g.balanceCents, applyCents };
}

/**
 * Boekt een bedrag af voor een order. Idempotent per (code, orderNumber);
 * conditioneel zodat het saldo nooit negatief wordt. Retourneert het werkelijk
 * afgeboekte bedrag.
 */
export async function redeemGiftcard(rawCode: string, orderNumber: string, amountCents: number): Promise<number> {
  const code = norm(rawCode);
  const want = Math.max(0, Math.floor(amountCents));
  if (!code || !orderNumber || want <= 0) return 0;
  const db = getDb();
  const g = await getGiftcardByCode(code);
  if (!g) return 0;

  // Al afgeboekt voor deze order? → idempotent terug.
  const existing = await db
    .select({ d: giftcardTransactions.deltaCents })
    .from(giftcardTransactions)
    .where(
      and(
        eq(giftcardTransactions.giftcardId, g.id),
        eq(giftcardTransactions.orderNumber, orderNumber),
        eq(giftcardTransactions.reason, "redeem")
      )
    )
    .limit(1);
  if (existing.length) return Math.abs(existing[0].d);

  const apply = Math.min(g.balanceCents, want);
  if (apply <= 0) return 0;
  const updated = await db
    .update(giftcards)
    .set({
      balanceCents: sql`${giftcards.balanceCents} - ${apply}`,
      status: sql`case when ${giftcards.balanceCents} - ${apply} <= 0 then 'depleted' else 'active' end`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(giftcards.id, g.id), sql`${giftcards.balanceCents} >= ${apply}`))
    .returning({ id: giftcards.id });
  if (!updated.length) return 0;
  await db
    .insert(giftcardTransactions)
    .values({ giftcardId: g.id, deltaCents: -apply, reason: "redeem", orderNumber });
  return apply;
}

/** Geeft een eerder voor deze order afgeboekt bedrag terug (mislukte betaling). Idempotent. */
export async function releaseGiftcard(rawCode: string, orderNumber: string): Promise<void> {
  const code = norm(rawCode);
  if (!code || !orderNumber) return;
  const db = getDb();
  const g = await getGiftcardByCode(code);
  if (!g) return;

  const spend = await db
    .select({ d: giftcardTransactions.deltaCents })
    .from(giftcardTransactions)
    .where(
      and(
        eq(giftcardTransactions.giftcardId, g.id),
        eq(giftcardTransactions.orderNumber, orderNumber),
        eq(giftcardTransactions.reason, "redeem")
      )
    )
    .limit(1);
  if (!spend.length) return;
  const released = await db
    .select({ id: giftcardTransactions.id })
    .from(giftcardTransactions)
    .where(
      and(
        eq(giftcardTransactions.giftcardId, g.id),
        eq(giftcardTransactions.orderNumber, orderNumber),
        eq(giftcardTransactions.reason, "release")
      )
    )
    .limit(1);
  if (released.length) return;

  const amount = Math.abs(spend[0].d);
  await db
    .update(giftcards)
    .set({ balanceCents: sql`${giftcards.balanceCents} + ${amount}`, status: "active", updatedAt: sql`now()` })
    .where(eq(giftcards.id, g.id));
  await db
    .insert(giftcardTransactions)
    .values({ giftcardId: g.id, deltaCents: amount, reason: "release", orderNumber });
}

/* ── Kopen ── */

export type PurchaseInput = {
  amountCents: number;
  recipientName: string;
  recipientEmail: string;
  senderName: string;
  message: string;
  buyerEmail: string;
  customerId?: string | null;
};

export async function purchaseGiftcard(
  input: PurchaseInput
): Promise<{ ok: true; id: string; code: string; amountCents: number } | { ok: false; error: string }> {
  const { giftcardConfig: cfg } = await getSettings();
  if (!cfg.enabled) return { ok: false, error: "Cadeaubonnen zijn momenteel niet beschikbaar." };
  const amount = Math.round(Number(input.amountCents));
  if (!Number.isFinite(amount) || amount < cfg.minCents || amount > cfg.maxCents) {
    return { ok: false, error: `Kies een bedrag tussen € ${(cfg.minCents / 100).toFixed(2)} en € ${(cfg.maxCents / 100).toFixed(2)}.` };
  }
  if (!input.recipientEmail || !/.+@.+\..+/.test(input.recipientEmail)) {
    return { ok: false, error: "Vul een geldig e-mailadres van de ontvanger in." };
  }
  const db = getDb();
  const expiresAt = new Date(Date.now() + cfg.validityMonths * 30 * 86400000);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const rows = await db
      .insert(giftcards)
      .values({
        code,
        initialCents: amount,
        balanceCents: 0,
        status: "pending",
        recipientName: (input.recipientName || "").trim().slice(0, 80),
        recipientEmail: input.recipientEmail.trim().slice(0, 160),
        senderName: (input.senderName || "").trim().slice(0, 80),
        message: (input.message || "").trim().slice(0, 500),
        buyerEmail: (input.buyerEmail || "").trim().slice(0, 160),
        customerId: input.customerId ?? null,
        expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: giftcards.id, code: giftcards.code });
    if (rows.length) return { ok: true, id: rows[0].id, code: rows[0].code, amountCents: amount };
  }
  return { ok: false, error: "Kon geen unieke code genereren. Probeer het opnieuw." };
}

export async function attachGiftcardPayment(giftcardId: string, molliePaymentId: string): Promise<void> {
  const db = getDb();
  await db.update(giftcards).set({ molliePaymentId, updatedAt: sql`now()` }).where(eq(giftcards.id, giftcardId));
}

/**
 * Mollie-status → cadeaubon. Idempotent (claim via conditionele UPDATE).
 * 'paid' → active, saldo = bedrag, issue-transactie + mail. Mislukt → cancelled.
 */
export async function applyGiftcardPaymentStatus(molliePaymentId: string, paymentStatus: string): Promise<void> {
  const db = getDb();
  if (paymentStatus === "paid" || paymentStatus === "authorized") {
    const claimed = await db
      .update(giftcards)
      .set({ status: "active", balanceCents: sql`${giftcards.initialCents}`, updatedAt: sql`now()` })
      .where(and(eq(giftcards.molliePaymentId, molliePaymentId), eq(giftcards.status, "pending")))
      .returning({ id: giftcards.id, initialCents: giftcards.initialCents });
    if (claimed.length) {
      await db.insert(giftcardTransactions).values({
        giftcardId: claimed[0].id,
        deltaCents: claimed[0].initialCents,
        reason: "issue",
        orderNumber: "",
      });
    }
    await sendGiftcardEmailOnce(molliePaymentId);
  } else if (paymentStatus === "canceled" || paymentStatus === "expired" || paymentStatus === "failed") {
    await db
      .update(giftcards)
      .set({ status: "cancelled", updatedAt: sql`now()` })
      .where(and(eq(giftcards.molliePaymentId, molliePaymentId), eq(giftcards.status, "pending")));
  }
}

/** Mailt de cadeaubon-code precies één keer (claim op issuedAt, net als de orderbevestiging). */
export async function sendGiftcardEmailOnce(molliePaymentId: string): Promise<void> {
  const db = getDb();
  const claimed = await db
    .update(giftcards)
    .set({ issuedAt: sql`now()` })
    .where(
      and(
        eq(giftcards.molliePaymentId, molliePaymentId),
        sql`${giftcards.status} in ('active','depleted')`,
        sql`${giftcards.issuedAt} is null`
      )
    )
    .returning({ id: giftcards.id });
  if (!claimed.length) return;
  const [g] = await db.select().from(giftcards).where(eq(giftcards.id, claimed[0].id)).limit(1);
  const ok = await sendGiftcardEmail(g);
  if (!ok) {
    // Niet verstuurd → claim terugdraaien zodat een volgende webhook het opnieuw probeert.
    await db.update(giftcards).set({ issuedAt: null }).where(eq(giftcards.id, claimed[0].id));
  }
}

/* ── In de winkel verzilveren (back-office / kassa) ── */

export type GiftcardTx = { deltaCents: number; reason: string; orderNumber: string; at: string };
export type GiftcardAdminInfo = {
  found: boolean;
  code: string;
  status?: string;
  initialCents?: number;
  balanceCents?: number;
  expiresAt?: string | null;
  recipientName?: string;
  transactions?: GiftcardTx[];
};

/** Volledige bon-info voor een medewerker (saldo, status, laatste transacties). */
export async function lookupGiftcardForStaff(rawCode: string): Promise<GiftcardAdminInfo> {
  const code = norm(rawCode);
  if (!code) return { found: false, code };
  const g = await getGiftcardByCode(code);
  if (!g) return { found: false, code };
  const db = getDb();
  const tx = await db
    .select({ deltaCents: giftcardTransactions.deltaCents, reason: giftcardTransactions.reason, orderNumber: giftcardTransactions.orderNumber, at: giftcardTransactions.createdAt })
    .from(giftcardTransactions)
    .where(eq(giftcardTransactions.giftcardId, g.id))
    .orderBy(desc(giftcardTransactions.createdAt))
    .limit(12);
  return {
    found: true,
    code: g.code,
    status: g.status,
    initialCents: g.initialCents,
    balanceCents: g.balanceCents,
    expiresAt: g.expiresAt ? g.expiresAt.toISOString() : null,
    recipientName: g.recipientName || "",
    transactions: tx.map((t) => ({ deltaCents: t.deltaCents, reason: t.reason, orderNumber: t.orderNumber, at: t.at ? new Date(t.at).toISOString() : "" })),
  };
}

/**
 * Boekt een bedrag af aan de kassa. Valideert eerst (status/saldo/verloop),
 * gebruikt een unieke winkel-referentie per verzilvering (idempotent per ref).
 */
export async function redeemGiftcardInStore(rawCode: string, amountCents: number): Promise<{ ok: boolean; error?: string; redeemedCents: number; newBalanceCents: number }> {
  const code = norm(rawCode);
  const want = Math.max(0, Math.floor(Number(amountCents) || 0));
  if (!code) return { ok: false, error: "Vul een code in.", redeemedCents: 0, newBalanceCents: 0 };
  if (want <= 0) return { ok: false, error: "Vul een geldig bedrag in.", redeemedCents: 0, newBalanceCents: 0 };
  const v = await validateGiftcard(code, want);
  if (!v.valid) return { ok: false, error: v.error, redeemedCents: 0, newBalanceCents: v.balanceCents };
  const ref = `WINKEL-${code}-${Date.now()}`;
  const redeemed = await redeemGiftcard(code, ref, want);
  const g = await getGiftcardByCode(code);
  return {
    ok: redeemed > 0,
    error: redeemed > 0 ? undefined : "Verzilveren mislukte — probeer opnieuw.",
    redeemedCents: redeemed,
    newBalanceCents: g?.balanceCents ?? 0,
  };
}

/** Cadeaubonnen gekocht door of gericht aan deze klant (voor 'Mijn GENTS'). */
export async function getGiftcardsForCustomer(customerId: string, email: string): Promise<Giftcard[]> {
  const db = getDb();
  const e = email.trim().toLowerCase();
  return db
    .select()
    .from(giftcards)
    .where(
      sql`${giftcards.status} <> 'pending' and (${giftcards.customerId} = ${customerId} or lower(${giftcards.recipientEmail}) = ${e} or lower(${giftcards.buyerEmail}) = ${e})`
    )
    .orderBy(desc(giftcards.createdAt))
    .limit(50);
}
