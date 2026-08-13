import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customers, loyaltyAccounts, loyaltyEvents, loyaltyMutations, posSales } from "@/db/schema";
import { boekInGrootboek, neonKlantVoorKassa } from "@/lib/loyalty-brug";
import { redeemableBalance } from "@/lib/loyalty-claim";
import { getSettings } from "@/lib/settings";

/** De kassareden in klanttaal: dit staat straks in het puntenoverzicht van de klant. */
function kassaReden(reden: string): string {
  const r = clean(reden).toLowerCase();
  if (r === "ingewisseld") return "Ingewisseld aan de kassa";
  if (r === "retour") return "Retour in de winkel";
  if (r.includes("achteraf")) return "Kassabon gekoppeld";
  return "Aankoop in de winkel";
}

/**
 * Wanneer worden kassapunten besteedbaar? Zelfde regel als een weborder: de
 * bondatum plus het vestingvenster, want ook een winkelaankoop kan terug.
 */
async function vestsAtVoorBon(saleId: string): Promise<Date> {
  const dagen = Math.max(0, (await getSettings()).loyaltyConfig?.vestingDays ?? 21);
  let basis = new Date();
  const id = clean(saleId);
  if (id) {
    const [bon] = await getDb().select({ op: posSales.createdAt }).from(posSales).where(eq(posSales.id, id)).limit(1);
    if (bon?.op instanceof Date && !isNaN(bon.op.getTime())) basis = bon.op;
  }
  return new Date(basis.getTime() + dagen * 86400000);
}

/**
 * Loyalty-core: kassa-spaarpunten in Neon (bron-van-waarheid; vervangt de
 * storegents-blob admin/loyalty-core.json — zie drizzle/0050_loyalty-core.sql).
 *
 * SALDO-CONSISTENTIE (bewuste keuze, gedocumenteerd):
 * Het saldo staat gematerialiseerd op loyalty_accounts en wordt SAMEN met de
 * ledger-insert gemuteerd in ÉÉN data-modifying-CTE-statement. Eén statement is
 * één impliciete transactie — ook over de neon-http-driver, die geen
 * multi-statement-transacties kent. Zo kan er nooit een mutatie zonder
 * saldo-wijziging landen (of andersom), en pakt de upsert een row-lock zodat
 * gelijktijdige boekingen netjes serialiseren (het blob-alternatief was
 * last-writer-wins). Alternatief was saldo = SUM(ledger) per read; dat is
 * verworpen omdat (a) de blob-backfill maar ≤500 mutaties per klant heeft
 * (het saldo uit de blob is completer dan de som van z'n eigen historie) en
 * (b) de blob een 0-vloer op het saldo had (nooit negatief) die met een kale
 * som niet reproduceerbaar is. De ledger blijft de volledige audit-bron
 * vanaf de cutover; saldo ≠ SUM(ledger) kan dus — by design.
 *
 * IDEMPOTENTIE: elke mutatie draagt een unieke mutation_key.
 *   - met saleId:    `<customerId>|<saleId>|<reason>` — zelfde dedup-regel als de
 *     blob (één earn/inwissel/terugdraai per bon per reden), óók over de
 *     backfill heen: een re-post van een al gebackfillde bon telt niet dubbel.
 *   - zonder saleId: het gegenereerde mutatie-id (handmatige correcties mogen
 *     altijd, blob-pariteit); backfill zonder saleId = `blob:<mutatie-id>`.
 */

type BlobMutation = {
  id?: string; delta?: number; reason?: string; saleId?: string; store?: string; at?: string;
};
type BlobAccount = {
  customerId?: string; name?: string; balance?: number; mutations?: BlobMutation[];
};

function clean(v: unknown): string { return String(v == null ? "" : v).trim(); }
function newMutId(): string {
  return `lm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Mutatie in blob-vorm — de kassa/klantpanelen verwachten dit shape. */
function rowToMutation(r: { id: string; delta: number; reason: string; saleId: string; store: string; createdAt: Date }) {
  return {
    id: r.id,
    delta: r.delta,
    reason: r.reason,
    saleId: r.saleId,
    store: r.store,
    at: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

/**
 * Saldo voor de kassa. Leest HET grootboek (`loyalty_events`) zodra we de klant
 * kunnen thuisbrengen — zie lib/loyalty-brug.
 *
 * Bewust het BESTEEDBARE (geveste) saldo: dat is wat de klant aan de balie
 * daadwerkelijk kan inwisselen, en het is hetzelfde getal waar
 * `redeemPointsForVoucher` mee rekent. Een hoger getal tonen dat je vervolgens
 * niet mag uitgeven is precies de discussie die je aan de kassa niet wilt.
 *
 * Valt de klant niet thuis te brengen, dan lezen we het oude kassa-grootboek —
 * anders zou een onbekend nummer stil op 0 uitkomen.
 */
export async function getLoyaltyBalanceCore(customerId: string): Promise<number> {
  const cid = clean(customerId);
  if (!cid) return 0;
  const { customerId: klant } = await neonKlantVoorKassa(cid);
  if (klant) return Math.max(0, await redeemableBalance(klant));

  const db = getDb();
  const [r] = await db.select({ balance: loyaltyAccounts.balance })
    .from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, cid)).limit(1);
  return r ? Number(r.balance) || 0 : 0;
}

/** Saldo + recente mutaties (nieuwste eerst) — voor het klant-paneel in de kassa. */
export async function getLoyaltyAccountCore(customerId: string, limit = 20): Promise<{
  customerId: string; name: string; balance: number;
  mutations: ReturnType<typeof rowToMutation>[];
}> {
  const cid = clean(customerId);
  if (!cid) return { customerId: "", name: "", balance: 0, mutations: [] };
  const db = getDb();
  const lim = Math.max(1, Math.min(200, Number(limit) || 20));

  /* Zelfde bron als het saldo: kunnen we de klant thuisbrengen, dan toont de
     kassa de ECHTE historie uit het grootboek — inclusief wat de klant online
     spaarde. Dat is precies wat een verkoper aan de balie moet kunnen zien. */
  const brug = await neonKlantVoorKassa(cid);
  if (brug.customerId) {
    const [klant, rijen] = await Promise.all([
      db.select({ naam: sql<string>`trim(${customers.firstName} || ' ' || ${customers.lastName})` })
        .from(customers).where(eq(customers.id, brug.customerId)).limit(1),
      db.select().from(loyaltyEvents).where(eq(loyaltyEvents.customerId, brug.customerId))
        .orderBy(desc(loyaltyEvents.createdAt)).limit(lim),
    ]);
    return {
      customerId: cid,
      name: clean(klant[0]?.naam),
      balance: Math.max(0, await redeemableBalance(brug.customerId)),
      mutations: rijen.map((r) => ({
        id: r.id,
        delta: r.points,
        reason: r.reason,
        // De kassa verwacht een bon-id; dat zit vooraan in de sleutel "<klant>|<bon>|<reden>".
        saleId: String(r.refId || "").split("|")[1] ?? "",
        store: "",
        at: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      })),
    };
  }

  const [[acc], muts] = await Promise.all([
    db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, cid)).limit(1),
    db.select().from(loyaltyMutations).where(eq(loyaltyMutations.customerId, cid))
      .orderBy(desc(loyaltyMutations.createdAt)).limit(lim),
  ]);
  return {
    customerId: cid,
    name: acc ? acc.name : "",
    balance: acc ? Number(acc.balance) || 0 : 0,
    mutations: muts.map(rowToMutation),
  };
}

export async function listLoyaltyMutationsCore(customerId: string, limit = 100) {
  const cid = clean(customerId);
  if (!cid) return [];
  const db = getDb();
  const lim = Math.max(1, Math.min(1000, Number(limit) || 100));
  const rows = await db.select().from(loyaltyMutations)
    .where(eq(loyaltyMutations.customerId, cid))
    .orderBy(desc(loyaltyMutations.createdAt)).limit(lim);
  return rows.map(rowToMutation);
}

/**
 * Boek een punten-mutatie: ledger-insert + saldo-upsert in ÉÉN atomair statement.
 * Idempotent op mutation_key → { balance, applied } (applied=0 bij dedup).
 * Saldo krijgt een 0-vloer (blob-pariteit: nooit negatief).
 */
export async function mutateLoyaltyCore(input: {
  customerId: string; delta: number; reason?: string;
  saleId?: string; store?: string; name?: string; actor?: string;
}): Promise<{ ok: boolean; balance: number; applied: number; error?: string }> {
  const cid = clean(input.customerId);
  const d = Math.round(Number(input.delta) || 0);
  if (!cid) return { ok: false, balance: 0, applied: 0, error: "customerId vereist." };
  if (d === 0) return { ok: true, balance: await getLoyaltyBalanceCore(cid), applied: 0 };
  const reason = clean(input.reason) || (d > 0 ? "verdiend" : "ingewisseld");
  const saleId = clean(input.saleId);
  const store = clean(input.store);
  const name = clean(input.name);
  const actor = clean(input.actor);
  const key = saleId ? `${cid}|${saleId}|${reason}` : newMutId();

  /* ── Eén grootboek ────────────────────────────────────────────────────────
     Kunnen we deze kassa-klant thuisbrengen, dan boeken we in `loyalty_events`
     — hetzelfde grootboek waar de klant online uit spaart én waar de kassa via
     `redeemPointsForVoucher` al uit inwisselt. Zonder dit spaarde een klant aan
     de balie in de ene pot en gaf hij uit uit de andere.

     Verdiende punten krijgen dezelfde vesting als een weborder (de bon kan
     retour); een afboeking is direct. Lukt het thuisbrengen niet, dan valt hij
     terug op het oude kassa-grootboek — luid gelogd, want na de migratie hoort
     dat niet meer voor te komen. */
  const brug = await neonKlantVoorKassa(cid, { saleId });
  if (brug.customerId) {
    const vestsAt = d > 0 ? await vestsAtVoorBon(saleId) : null;
    await boekInGrootboek({ customerId: brug.customerId, punten: d, reden: kassaReden(reason), sleutel: key, vestsAt });
    return { ok: true, balance: Math.max(0, await redeemableBalance(brug.customerId)), applied: d };
  }
  console.warn(`[loyalty-core] kassa-klant ${cid} niet thuis te brengen — geboekt in het oude kassa-grootboek.`);

  const db = getDb();
  const res = await db.execute<{ new_balance: number | null; applied: number }>(sql`
    with ins as (
      insert into ${loyaltyMutations} ("customer_id", "delta", "reason", "sale_id", "store", "actor", "mutation_key")
      values (${cid}, ${d}, ${reason}, ${saleId}, ${store}, ${actor}, ${key})
      on conflict ("mutation_key") do nothing
      returning "delta"
    ), acc as (
      insert into ${loyaltyAccounts} ("customer_id", "name", "balance", "updated_at")
      select ${cid}, ${name}, greatest(0, i."delta"), now() from ins i
      on conflict ("customer_id") do update set
        "balance" = greatest(0, ${loyaltyAccounts}."balance" + (select "delta" from ins)),
        "name" = case when ${name} <> '' then ${name} else ${loyaltyAccounts}."name" end,
        "updated_at" = now()
      returning "balance"
    )
    select (select "balance" from acc) as new_balance, (select count(*)::int from ins) as applied
  `);
  const row = res.rows?.[0];
  const applied = Number(row?.applied) || 0;
  if (applied > 0) return { ok: true, balance: Number(row?.new_balance) || 0, applied: d };
  // Dedup (mutation_key bestond al) → huidig saldo teruggeven, niets geboekt.
  return { ok: true, balance: await getLoyaltyBalanceCore(cid), applied: 0 };
}

/**
 * Draai de loyalty van een verkoop terug o.b.v. wat er ÉCHT gemuteerd is (netto
 * van earn + inwissel voor deze saleId), niet via een herberekening — klopt ook
 * als de earn eerder faalde (netto 0 → niets terugdraaien) of het tarief
 * inmiddels wijzigde. Idempotent: de terugdraai draagt zelf ook een
 * mutation_key, dus een tweede terugdraai doet niets. (Blob-pariteit.)
 */
export async function reverseLoyaltySaleCore(input: {
  customerId: string; saleId: string; store?: string; actor?: string;
}): Promise<{ ok: boolean; balance: number; applied: number; error?: string }> {
  const cid = clean(input.customerId);
  const sid = clean(input.saleId);
  if (!cid || !sid) return { ok: false, balance: 0, applied: 0, error: "customerId + saleId vereist." };
  const REV = "verkoop geannuleerd";
  const db = getDb();

  /* Hoeveel is er voor DEZE bon geboekt? Sinds het samenvoegen kan dat in het
     grootboek staan (refId begint met "<klant>|<bon>|") of nog in het oude
     kassa-grootboek. Allebei optellen: een bon van vóór de migratie moet ook
     terug te draaien zijn. */
  const brug = await neonKlantVoorKassa(cid, { saleId: sid });
  if (brug.customerId) {
    const [al] = await db
      .select({ id: loyaltyEvents.id })
      .from(loyaltyEvents)
      .where(and(eq(loyaltyEvents.refType, "pos_sale"), eq(loyaltyEvents.refId, `${cid}|${sid}|${REV}`)))
      .limit(1);
    if (al) return { ok: true, balance: await getLoyaltyBalanceCore(cid), applied: 0 };
  }

  const net = await db.execute<{ net: number }>(sql`
    select coalesce((
      select sum("delta")::int from ${loyaltyMutations}
      where "customer_id" = ${cid} and "sale_id" = ${sid} and "reason" <> ${REV}
    ), 0) + coalesce((
      select sum(e."points")::int from ${loyaltyEvents} e
      where e."ref_type" = 'pos_sale' and e."ref_id" like ${`${cid}|${sid}|%`}
        and e."ref_id" <> ${`${cid}|${sid}|${REV}`}
    ), 0) as net
  `);
  const n = Number(net.rows?.[0]?.net) || 0;
  if (n === 0) return { ok: true, balance: await getLoyaltyBalanceCore(cid), applied: 0 };

  // Race met een parallelle terugdraai is veilig: de tweede no-opt op de key.
  return mutateLoyaltyCore({
    customerId: cid, delta: -n, reason: REV, saleId: sid,
    store: clean(input.store), actor: clean(input.actor),
  });
}

/**
 * Eenmalige backfill vanuit de blob (admin/loyalty-core.json) — idempotent én
 * race-veilig: de baseline wordt per account precies één keer bij het saldo
 * geteld (WHERE backfilled_at IS NULL), mutaties dedupen op mutation_key.
 * Post-cutover-mutaties die vóór de backfill al in Neon landden blijven staan:
 * de baseline wordt erbij OPGETELD, niet eroverheen gezet.
 */
export async function backfillLoyaltyCore(accounts: BlobAccount[]): Promise<{
  ok: boolean; accounts: number; accountsBackfilled: number; mutationsInserted: number;
}> {
  const list = Array.isArray(accounts) ? accounts : [];
  const db = getDb();
  let accountsBackfilled = 0;
  let mutationsInserted = 0;

  for (const a of list) {
    const cid = clean(a?.customerId);
    if (!cid) continue;
    const name = clean(a?.name);
    const balance = Math.max(0, Math.round(Number(a?.balance) || 0));

    const up = await db.execute<{ customer_id: string }>(sql`
      insert into ${loyaltyAccounts} ("customer_id", "name", "balance", "backfilled_at", "updated_at")
      values (${cid}, ${name}, ${balance}, now(), now())
      on conflict ("customer_id") do update set
        "balance" = greatest(0, ${loyaltyAccounts}."balance" + ${balance}),
        "name" = case when ${loyaltyAccounts}."name" = '' then ${name} else ${loyaltyAccounts}."name" end,
        "backfilled_at" = now(),
        "updated_at" = now()
      where ${loyaltyAccounts}."backfilled_at" is null
      returning "customer_id"
    `);
    if (up.rows?.length) accountsBackfilled += 1;

    const muts = Array.isArray(a?.mutations) ? a.mutations : [];
    if (!muts.length) continue;
    const seen = new Set<string>();
    const rows = [];
    for (const m of muts) {
      const delta = Math.round(Number(m?.delta) || 0);
      if (delta === 0) continue;
      const saleId = clean(m?.saleId);
      const reason = clean(m?.reason);
      const key = saleId ? `${cid}|${saleId}|${reason}` : `blob:${clean(m?.id) || newMutId()}`;
      if (seen.has(key)) continue; // zelfde statement mag een key niet 2× raken
      seen.add(key);
      const at = clean(m?.at);
      const atDate = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date();
      rows.push({
        customerId: cid, delta, reason, saleId, store: clean(m?.store),
        actor: "blob-backfill", mutationKey: key, createdAt: atDate,
      });
    }
    for (let i = 0; i < rows.length; i += 200) {
      const ins = await db.insert(loyaltyMutations).values(rows.slice(i, i + 200))
        .onConflictDoNothing({ target: loyaltyMutations.mutationKey })
        .returning({ id: loyaltyMutations.id });
      mutationsInserted += ins.length;
    }
  }
  return { ok: true, accounts: list.length, accountsBackfilled, mutationsInserted };
}
