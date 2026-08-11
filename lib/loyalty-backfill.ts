import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getSettings } from "@/lib/settings";
import { reverseOrderLoyalty } from "@/lib/loyalty-claim";

/**
 * Achterstallige spaarpunten bijboeken.
 *
 * Waarom dit bestaat: punten werden maar op twee toevallige momenten geschreven —
 * tijdens het versturen van de bevestigingsmail en bij een magic-link login. Een
 * order die daarbuiten betaald raakte (of een account dat pas ná de Shopify-import
 * inlogde) kreeg nooit punten, en er was niets dat dat later alsnog rechtzette.
 * Resultaat bij het schrijven hiervan: 28.392 betaalde orders met een account,
 * tegenover 4 regels in het hele grootboek.
 *
 * De bijschrijving zelf gebeurt in SQL en niet via creditOnce(): 28k orders × vier
 * losse round-trips over neon-http duurt uren. De regel is triviaal genoeg om exact
 * te spiegelen — pointsForCents() is floor(cents/100) × 1 punt per euro. Idempotentie
 * komt van de unieke index op (ref_type, ref_id), dezelfde die creditOnce gebruikt,
 * dus dit kan niet dubbel boeken en mag zo vaak draaien als je wilt.
 */

const PAID = ["paid", "shipped", "ready_pickup", "delivered"];

export type BackfillResult = {
  /** Orders die nog punten missen vóór deze ronde. */
  openstaand: number;
  /** Regels die deze ronde geboekt zijn (0 bij dryRun). */
  geboekt: number;
  punten: number;
  klanten: number;
  /** Retour-correcties die deze ronde alsnog verwerkt zijn. */
  correcties: number;
  dryRun: boolean;
};

/** Alleen orders binnen het terugkijkvenster meenemen (undefined = hele historie). */
function venster(lookbackDays?: number) {
  return lookbackDays == null
    ? sql``
    : sql` and coalesce(o.paid_at, o.created_at) >= now() - make_interval(days => ${Math.max(0, lookbackDays)})`;
}

/** Wat staat er nog open: hoeveel orders, hoeveel punten, hoeveel klanten. */
export async function openstaandeOrders(lookbackDays?: number): Promise<{ orders: number; punten: number; klanten: number }> {
  const db = getDb();
  const r = await db.execute<{ n: number; punten: number; klanten: number }>(sql`
    select count(*)::int n,
           coalesce(sum(o.total_cents / 100), 0)::int punten,
           count(distinct o.customer_id)::int klanten
    from orders o
    where o.customer_id is not null
      and o.status in (${sql.join(PAID.map((s) => sql`${s}`), sql`, `)})
      and o.total_cents >= 100
      and not exists (select 1 from loyalty_events e where e.ref_type = 'web_order' and e.ref_id = o.id::text)
      ${venster(lookbackDays)}`);
  const row = r.rows[0];
  return { orders: Number(row?.n) || 0, punten: Number(row?.punten) || 0, klanten: Number(row?.klanten) || 0 };
}

/**
 * Wat kost de backfill écht? Niet elk punt is inwisselbaar: dat kan pas vanaf de
 * drempel (standaard 500 punten = € 500 besteed) en in stappen. Deze raming telt
 * per klant het grootboek plus wat de backfill zou toevoegen, en rekent alleen het
 * deel dat daadwerkelijk in te wisselen is. Voor de go/no-go-afweging.
 */
export async function inwisselraming(): Promise<{ klanten: number; punten: number; waardeCents: number; drempel: number }> {
  const lc = (await getSettings()).loyaltyConfig as { redeemCentsPerPoint?: number; redeemMinPoints?: number; redeemStepPoints?: number };
  const centsPerPoint = Number(lc?.redeemCentsPerPoint) > 0 ? Number(lc.redeemCentsPerPoint) : 5;
  const drempel = Number(lc?.redeemMinPoints) > 0 ? Number(lc.redeemMinPoints) : 500;
  const stap = lc?.redeemStepPoints == null ? 500 : Math.max(1, Number(lc.redeemStepPoints));
  const db = getDb();
  const r = await db.execute<{ klanten: number; punten: number }>(sql`
    with per_klant as (
      select o.customer_id, sum(o.total_cents / 100)::int nieuw
      from orders o
      where o.customer_id is not null
        and o.status in (${sql.join(PAID.map((s) => sql`${s}`), sql`, `)})
        and o.total_cents >= 100
        and not exists (select 1 from loyalty_events e where e.ref_type = 'web_order' and e.ref_id = o.id::text)
      group by o.customer_id
    ), totaal as (
      select k.customer_id,
             k.nieuw + coalesce((select sum(e.points)::int from loyalty_events e where e.customer_id = k.customer_id), 0) saldo
      from per_klant k
    )
    select count(*)::int klanten,
           -- alleen hele inwisselstappen tellen mee; de rest blijft staan
           coalesce(sum((saldo / ${stap})::int * ${stap}), 0)::int punten
    from totaal where saldo >= ${drempel}`);
  const punten = Number(r.rows[0]?.punten) || 0;
  return { klanten: Number(r.rows[0]?.klanten) || 0, punten, waardeCents: punten * centsPerPoint, drempel };
}

/**
 * Boek één batch achterstallige orders bij. Nieuwste eerst — bij een onderbroken
 * backfill heeft de klant die vandaag inlogt z'n punten dan al.
 */
export async function backfillOrderLoyalty(opts: { limit?: number; dryRun?: boolean; lookbackDays?: number } = {}): Promise<BackfillResult> {
  const lim = Math.max(1, Math.min(5000, Number(opts.limit) || 500));
  const dryRun = Boolean(opts.dryRun);
  const db = getDb();
  const open = await openstaandeOrders(opts.lookbackDays);
  if (dryRun || open.orders === 0) {
    return { openstaand: open.orders, geboekt: 0, punten: open.punten, klanten: open.klanten, correcties: 0, dryRun };
  }

  const days = Math.max(0, (await getSettings()).loyaltyConfig?.vestingDays ?? 21);
  const ins = await db.execute<{ regels: number; punten: number; klanten: number }>(sql`
    with kandidaten as (
      select o.id, o.customer_id, o.total_cents, coalesce(o.paid_at, o.created_at) basis
      from orders o
      where o.customer_id is not null
        and o.status in (${sql.join(PAID.map((s) => sql`${s}`), sql`, `)})
        and o.total_cents >= 100
        and not exists (select 1 from loyalty_events e where e.ref_type = 'web_order' and e.ref_id = o.id::text)
        ${venster(opts.lookbackDays)}
      order by coalesce(o.paid_at, o.created_at) desc
      limit ${lim}
    ), geboekt as (
      insert into loyalty_events (customer_id, points, reason, ref_type, ref_id, vests_at)
      select k.customer_id, (k.total_cents / 100)::int, 'Weborder gekoppeld', 'web_order', k.id::text,
             k.basis + make_interval(days => ${days})
      from kandidaten k
      on conflict (ref_type, ref_id) do nothing
      returning customer_id, points
    )
    select count(*)::int regels, coalesce(sum(points), 0)::int punten,
           count(distinct customer_id)::int klanten
    from geboekt`);
  const row = ins.rows[0] ?? { regels: 0, punten: 0, klanten: 0 };

  /* Retouren die vóór deze backfill al afgehandeld waren, alsnog terugdraaien —
     anders levert teruggestuurde waar punten op. reverseOrderLoyalty is idempotent
     per (order, retour) en kapt op wat er voor die order daadwerkelijk geboekt is. */
  let correcties = 0;
  const teCorrigeren = await db.execute<{ customer_id: string; order_id: string; return_id: string; items_cents: number }>(sql`
    select o.customer_id, o.id order_id, r.id return_id, r.items_cents
    from returns r
    join orders o on o.id = r.order_id
    where r.status = 'completed'
      and o.customer_id is not null
      and exists (select 1 from loyalty_events e where e.ref_type = 'web_order' and e.ref_id = o.id::text)
      and not exists (
        select 1 from loyalty_events e
        where e.ref_type = 'loyalty_reversal' and e.ref_id = o.id::text || ':' || r.id::text)
    limit ${lim}`);
  for (const c of teCorrigeren.rows) {
    await reverseOrderLoyalty(String(c.customer_id), String(c.order_id), Number(c.items_cents) || 0, String(c.return_id));
    correcties++;
  }

  // Saldo-cache gelijktrekken met het grootboek — zelfherstellend, ook voor drift
  // die buiten deze backfill is ontstaan.
  await db.execute(sql`
    update customers c
    set loyalty_points = x.total, updated_at = now()
    from (select customer_id, sum(points)::int total from loyalty_events group by customer_id) x
    where x.customer_id = c.id and c.loyalty_points is distinct from x.total`);

  return {
    openstaand: open.orders,
    geboekt: Number(row.regels) || 0,
    punten: Number(row.punten) || 0,
    klanten: Number(row.klanten) || 0,
    correcties,
    dryRun: false,
  };
}
