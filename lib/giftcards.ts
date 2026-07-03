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
  // Claim-first, in ÉÉN atomair SQL-statement (neon-http kent geen transacties): schrijf de
  // 'redeem'-transactie idempotent in — de unieke index (giftcard_id, order_number, 'redeem')
  // serialiseert twee gelijktijdige same-ref-redeems, precies één wint de INSERT — en boek
  // alléén voor die winnende claim het saldo conditioneel af (nooit onder 0). De ander (retry
  // of race) krijgt via de fallback het al-afgeboekte bedrag terug. `least` capt op het saldo
  // (partiële afboeking als er meer gevraagd wordt dan er op staat).
  const res = await db.execute(sql`
    with gc as (
      select id, balance_cents from giftcards
      where code = ${code}
        and status not in ('pending','cancelled')
        and balance_cents > 0
        and (expires_at is null or expires_at > now())
    ),
    claim as (
      insert into giftcard_transactions (giftcard_id, order_number, reason, delta_cents)
      select id, ${orderNumber}, 'redeem', -least(balance_cents, ${want}) from gc
      on conflict (giftcard_id, order_number, reason) do nothing
      returning giftcard_id, delta_cents
    ),
    upd as (
      update giftcards g set
        balance_cents = g.balance_cents + c.delta_cents,
        status = case when g.balance_cents + c.delta_cents <= 0 then 'depleted' else 'active' end,
        updated_at = now()
      from claim c
      where g.id = c.giftcard_id
      returning g.id
    )
    select coalesce(
      (select -delta_cents from claim),
      (select -delta_cents from giftcard_transactions t
        where t.giftcard_id = (select id from gc) and t.order_number = ${orderNumber} and t.reason = 'redeem' limit 1),
      0
    )::int as applied
  `);
  const applied = Number((res.rows?.[0] as { applied?: number } | undefined)?.applied ?? 0);
  return applied > 0 ? applied : 0;
}

/** Geeft een eerder voor deze order afgeboekt bedrag terug (mislukte betaling). Idempotent. */
export async function releaseGiftcard(rawCode: string, orderNumber: string): Promise<void> {
  const code = norm(rawCode);
  if (!code || !orderNumber) return;
  const db = getDb();
  // Claim-first + atomair (zie redeemGiftcard): schrijf de 'release'-transactie idempotent in
  // (unieke index serialiseert concurrente releases) en crediteer — alleen voor de winnende
  // claim — het eerder voor deze ref afgeboekte bedrag terug. Geen redeem-tx / al gereleased →
  // niets te doen.
  await db.execute(sql`
    with red as (
      select t.giftcard_id, -t.delta_cents as amt
      from giftcard_transactions t
      where t.giftcard_id = (select id from giftcards where code = ${code})
        and t.order_number = ${orderNumber} and t.reason = 'redeem'
      limit 1
    ),
    claim as (
      insert into giftcard_transactions (giftcard_id, order_number, reason, delta_cents)
      select giftcard_id, ${orderNumber}, 'release', amt from red where amt > 0
      on conflict (giftcard_id, order_number, reason) do nothing
      returning giftcard_id, delta_cents
    )
    update giftcards g set
      balance_cents = g.balance_cents + c.delta_cents,
      status = 'active',
      updated_at = now()
    from claim c
    where g.id = c.giftcard_id
  `);
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
      }).onConflictDoNothing();
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

export type ActivateResult =
  | { ok: true; code: string; balanceCents: number; wasCreated?: boolean; alreadyActive?: boolean }
  | { ok: false; code: string; error: string };

/**
 * Activeer/geef een FYSIEKE cadeaubon uit aan de kassa: scan de boncode + hang een bedrag
 * eraan. De bon komt in dezelfde `giftcards`-tabel als de online-bonnen → daarna overal
 * inwisselbaar (kassa + web) via validate/redeem, zónder extra werk.
 *
 * Idempotent per `ref` (= sale-clientRef). Atomair (neon-http kent geen transacties):
 *  - Nieuwe code → maak de bon in ÉÉN statement actief mét saldo én een 'activate'-transactie.
 *    De unieke `code`-index serialiseert twee gelijktijdige eerste-activaties (één wint).
 *  - Code bestond al mét een 'activate'-tx op DEZE ref → idempotent ok (retry/dubbele sync).
 *  - Code bestond al zónder deze ref → WEIGEREN (dezelfde fysieke bon niet 2× verkopen).
 */
export async function activateGiftcardInStore(rawCode: string, amountCents: number, ref: string): Promise<ActivateResult> {
  const code = norm(rawCode);
  const amount = Math.round(Number(amountCents) || 0);
  if (!code || code.length < 6) return { ok: false, code, error: "Ongeldige of te korte boncode." };
  if (!ref) return { ok: false, code, error: "Geen referentie voor de activatie." };
  const { giftcardConfig: cfg } = await getSettings();
  if (amount < cfg.minCents || amount > cfg.maxCents) {
    return { ok: false, code, error: `Kies een bedrag tussen € ${(cfg.minCents / 100).toFixed(2)} en € ${(cfg.maxCents / 100).toFixed(2)}.` };
  }
  const db = getDb();
  const expiresAt = new Date(Date.now() + cfg.validityMonths * 30 * 86400000).toISOString();
  // Nieuwe code → bon + saldo + activate-tx in één atomair statement (geen tussenstap-gat).
  const ins = await db.execute(sql`
    with ins as (
      insert into giftcards (code, initial_cents, balance_cents, status, issued_at, expires_at)
      values (${code}, ${amount}, ${amount}, 'active', now(), ${expiresAt})
      on conflict (code) do nothing
      returning id
    ),
    tx as (
      insert into giftcard_transactions (giftcard_id, order_number, reason, delta_cents)
      select id, ${ref}, 'activate', ${amount} from ins
      on conflict (giftcard_id, order_number, reason) do nothing
      returning giftcard_id
    )
    select id from ins
  `);
  if (ins.rows?.length) return { ok: true, code, balanceCents: amount, wasCreated: true };

  // Code bestond al: idempotente retry van dezelfde sale, of een poging 'm 2× te verkopen.
  const g = await getGiftcardByCode(code);
  if (!g) return { ok: false, code, error: "Kon de cadeaubon niet activeren." };
  const mine = await db
    .select({ id: giftcardTransactions.id })
    .from(giftcardTransactions)
    .where(and(eq(giftcardTransactions.giftcardId, g.id), eq(giftcardTransactions.orderNumber, ref), eq(giftcardTransactions.reason, "activate")))
    .limit(1);
  if (mine.length) return { ok: true, code, balanceCents: g.balanceCents, alreadyActive: true };
  return { ok: false, code, error: "Deze cadeaubon is al geactiveerd." };
}

/**
 * Draai een aan-de-kassa geactiveerde bon terug (annulering van de bon-verkoop): saldo 0 +
 * status 'cancelled'. Idempotent per `ref`. WEIGERT als de bon al (deels) is ingewisseld —
 * dan heeft de klant er al mee betaald en moet een mens het afhandelen (geen geld-lek).
 */
export async function deactivateGiftcardInStore(rawCode: string, ref: string): Promise<{ ok: boolean; error?: string; refundedCents: number }> {
  const code = norm(rawCode);
  if (!code || !ref) return { ok: false, error: "Ongeldige invoer.", refundedCents: 0 };
  const db = getDb();
  const g = await getGiftcardByCode(code);
  if (!g) return { ok: false, error: "Onbekende cadeaubon.", refundedCents: 0 };
  const spent = await db
    .select({ id: giftcardTransactions.id })
    .from(giftcardTransactions)
    .where(and(eq(giftcardTransactions.giftcardId, g.id), eq(giftcardTransactions.reason, "redeem")))
    .limit(1);
  if (spent.length) return { ok: false, error: "Cadeaubon is al (deels) gebruikt — handmatig afhandelen.", refundedCents: 0 };
  // Claim-first + atomair: één deactivate-tx per ref (unieke index), saldo 0 + cancelled.
  const res = await db.execute(sql`
    with claim as (
      insert into giftcard_transactions (giftcard_id, order_number, reason, delta_cents)
      select id, ${ref}, 'deactivate', -balance_cents from giftcards where id = ${g.id}
      on conflict (giftcard_id, order_number, reason) do nothing
      returning giftcard_id
    )
    update giftcards g set balance_cents = 0, status = 'cancelled', updated_at = now()
    from claim c where g.id = c.giftcard_id
    returning g.id
  `);
  const done = (res.rows?.length ?? 0) > 0;
  return { ok: true, refundedCents: done ? g.balanceCents : 0 };
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
