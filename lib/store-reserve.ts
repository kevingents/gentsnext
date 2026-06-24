import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/**
 * Fase D — anti-oversell-reservering (hard slot-lock).
 *
 * SRS is alleen WMS en ziet de webverkopen niet; de afgeleide web-reservering
 * (lib/store-core) telt een order pas mee zodra die betaald + gepland is. In het
 * gat daartussen — twee klanten die tegelijk het laatste stuk afrekenen — zou de
 * site kunnen overselllen. Daarom claimen we bij het aanmaken van de order een
 * korte HOLD via een atomaire teller:
 *
 *   gate = UPDATE counter SET reserved = reserved + qty
 *          WHERE reserved + qty <= gross   (gross = SRS + pos − afgeleide reservering)
 *
 * Dit is één statement: de rij-lock op de teller serialiseert gelijktijdige
 * checkouts (de 2e wacht en herziet de WHERE met de nieuwe reserved → afgewezen).
 * neon-http kent geen interactieve transacties, dus dit is de enige correcte gate.
 *
 * Holds krijgen een TTL (verlaten checkout valt vanzelf vrij) en worden gericht
 * vrijgegeven zodra de order betaald+gepland is (dan neemt de afgeleide
 * reservering het over → geen dubbeltelling) of als de betaling mislukt.
 */

export const WEB_POOL = "online";
const DEFAULT_TTL_MIN = 30;

export type ReserveRequest = { location: string; stockKey: string; qty: number; gross: number };

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** Ruim verlopen holds op en geef hun teller-saldo vrij (atomair, idempotent). */
export async function sweepExpiredHolds(): Promise<void> {
  const db = getDb();
  try {
    await db.execute(sql`
      with expired as (
        delete from web_stock_holds where expires_at < now()
        returning location, stock_key, qty
      ), agg as (
        select location, stock_key, sum(qty)::int as q from expired group by location, stock_key
      )
      update web_stock_reservation_counter c
      set reserved = greatest(0, c.reserved - agg.q), updated_at = now()
      from agg
      where c.location = agg.location and c.stock_key = agg.stock_key
    `);
  } catch {
    // Sweep is best-effort; nooit een checkout blokkeren omdat opruimen faalt.
  }
}

/** Probeer één (locatie, sku) atomair te claimen. true = gereserveerd. */
async function tryReserveOne(orderId: string, loc: string, key: string, qty: number, gross: number, ttlMin: number): Promise<boolean> {
  const db = getDb();
  // Zorg dat de tellerrij bestaat, zodat de gate altijd via ON CONFLICT/UPDATE
  // loopt en de WHERE-voorwaarde geldt (ook bij de allereerste reservering).
  await db.execute(sql`
    insert into web_stock_reservation_counter (location, stock_key) values (${loc}, ${key})
    on conflict (location, stock_key) do nothing
  `);
  const res = await db.execute<{ id: string }>(sql`
    with g as (
      update web_stock_reservation_counter
      set reserved = reserved + ${qty}, updated_at = now()
      where location = ${loc} and stock_key = ${key} and reserved + ${qty} <= ${gross}
      returning reserved
    )
    insert into web_stock_holds (order_id, location, stock_key, qty, expires_at)
    select ${orderId}, ${loc}, ${key}, ${qty}, now() + make_interval(mins => ${ttlMin})
    from g
    returning id
  `);
  return res.rows.length > 0;
}

/**
 * Reserveer de voorraad voor een order. Aggregeer per (locatie, stockKey).
 * Slaagt alles → { ok:true }. Faalt één regel → rol de al-geclaimde holds van
 * deze order terug en geef de gefaalde sleutels terug (order kan niet door).
 */
export async function reserveOrderStock(orderId: string, requests: ReserveRequest[], ttlMin = DEFAULT_TTL_MIN): Promise<{ ok: boolean; failed: string[] }> {
  await sweepExpiredHolds();
  // Aggregeer dubbele (locatie, sku) tot één claim.
  const byPair = new Map<string, ReserveRequest>();
  for (const r of requests) {
    const loc = lower(r.location);
    const key = lower(r.stockKey);
    const qty = Math.max(0, Math.round(Number(r.qty) || 0));
    if (!loc || !key || !qty) continue;
    const id = `${loc}|${key}`;
    const cur = byPair.get(id);
    if (cur) cur.qty += qty;
    else byPair.set(id, { location: loc, stockKey: key, qty, gross: Math.max(0, Math.floor(Number(r.gross) || 0)) });
  }

  const failed: string[] = [];
  for (const r of byPair.values()) {
    const ok = await tryReserveOne(orderId, r.location, r.stockKey, r.qty, r.gross, ttlMin);
    if (!ok) failed.push(r.stockKey);
  }
  if (failed.length) {
    await releaseOrderHolds(orderId); // rol partiële claims terug
    return { ok: false, failed };
  }
  return { ok: true, failed: [] };
}

/** Geef alle holds van een order vrij en decrementeer de teller (atomair). */
export async function releaseOrderHolds(orderId: string): Promise<void> {
  const db = getDb();
  try {
    await db.execute(sql`
      with rel as (
        delete from web_stock_holds where order_id = ${orderId}
        returning location, stock_key, qty
      ), agg as (
        select location, stock_key, sum(qty)::int as q from rel group by location, stock_key
      )
      update web_stock_reservation_counter c
      set reserved = greatest(0, c.reserved - agg.q), updated_at = now()
      from agg
      where c.location = agg.location and c.stock_key = agg.stock_key
    `);
  } catch {
    // Vrijgave is best-effort; verlopen holds vangt de sweep alsnog op.
  }
}

/**
 * Verleng de holds van een order (nieuwe expires_at = now()+ttlMin). Aangeroepen
 * zodra een betaling wordt gestart: de standaard-TTL (30 min) kan korter zijn dan
 * het betaalvenster van trage methoden (bv. banktransfer), waardoor de sweep de
 * hold te vroeg zou vrijgeven en het laatste stuk weer verkoopbaar zou worden vóór
 * de betaling binnen is. Definitieve vrijgave loopt via de webhook (betaald →
 * afgeleide reservering neemt over; mislukt/verlopen → releaseOrderHolds).
 */
export async function renewOrderHolds(orderId: string, ttlMin = DEFAULT_TTL_MIN): Promise<void> {
  const db = getDb();
  try {
    await db.execute(sql`
      update web_stock_holds set expires_at = now() + make_interval(mins => ${Math.max(1, Math.round(ttlMin))})
      where order_id = ${orderId}
    `);
  } catch {
    // Best-effort.
  }
}
