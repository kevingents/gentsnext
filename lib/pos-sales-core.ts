import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { posSales } from "@/db/schema";

/**
 * Kassa-verkopen in de Neon-core (bron-van-waarheid; vervangt de storegents-blob
 * admin/pos-sales.json). Fase 1 — getrouwe mirror: de kassa bouwt de verkoop (euro's,
 * lines/payments/korting/loyalty) en die wordt hier opgeslagen als `data` JSONB +
 * een paar queryable kolommen. Idempotent op client_ref (offline sync).
 */

type Sale = Record<string, unknown> & { id?: string; store?: string; clientRef?: string };

function rowToSale(r: { data: unknown }): Sale {
  return (r?.data ?? {}) as Sale;
}
function colsFromSale(sale: Sale) {
  return {
    id: String(sale.id || ""),
    clientRef: String(sale.clientRef || ""),
    store: String(sale.store || ""),
    cashier: String((sale as { cashier?: string }).cashier || ""),
    cashierId: String((sale as { cashierId?: string }).cashierId || ""),
    customerId: String((sale as { customerId?: string }).customerId || ""),
    totalCents: Math.round((Number((sale as { total?: number }).total) || 0) * 100),
    itemCount: Number((sale as { itemCount?: number }).itemCount) || 0,
    cancelled: Boolean((sale as { cancelled?: boolean }).cancelled),
    srsPosted: Boolean((sale as { srsPosted?: boolean }).srsPosted),
    data: sale,
    createdAt: (sale as { createdAt?: string }).createdAt ? new Date(String((sale as { createdAt?: string }).createdAt)) : new Date(),
  };
}

/** Alle retour-records voor één originele bon — voor de over-retour-guard aan de
 *  kassa. Neon is hier de consistente bron: de blob kan per serverless-instantie
 *  achterlopen (read-after-write), waardoor een nét verwerkte retour daar nog
 *  onzichtbaar is en dezelfde bon dubbel geretourneerd kon worden. */
export async function listRetourenByOrigCore(origSaleId: string): Promise<Sale[]> {
  const id = String(origSaleId || "").trim();
  if (!id) return [];
  const db = getDb();
  const rows = await db.select().from(posSales)
    .where(sql`${posSales.data} ->> 'origSaleId' = ${id} and ${posSales.data} ->> 'kind' = 'retour'`)
    .limit(100);
  return rows.map(rowToSale);
}

/** Leg een verkoop vast. Idempotent op client_ref → dezelfde bon boekt nooit dubbel. */
export async function recordPosSaleCore(sale: Sale): Promise<{ ok: boolean; sale?: Sale; deduped?: boolean; error?: string }> {
  if (!sale?.id || !sale?.store) return { ok: false, error: "Ongeldige verkoop (id + store vereist)." };
  const db = getDb();
  const row = colsFromSale(sale);

  if (row.clientRef) {
    const [existing] = await db.select().from(posSales).where(eq(posSales.clientRef, row.clientRef)).limit(1);
    if (existing) return { ok: true, sale: rowToSale(existing), deduped: true };
  }
  const [ins] = await db.insert(posSales).values(row).onConflictDoNothing().returning();
  if (ins) return { ok: true, sale: rowToSale(ins) };

  // Conflict (race op id/client_ref) → haal de bestaande op.
  if (row.clientRef) {
    const [e] = await db.select().from(posSales).where(eq(posSales.clientRef, row.clientRef)).limit(1);
    if (e) return { ok: true, sale: rowToSale(e), deduped: true };
  }
  const [byId] = await db.select().from(posSales).where(eq(posSales.id, row.id)).limit(1);
  return { ok: true, sale: byId ? rowToSale(byId) : sale, deduped: true };
}

export async function listPosSalesCore(store: string, limit = 50): Promise<Sale[]> {
  const db = getDb();
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = store
    ? await db.select().from(posSales).where(eq(posSales.store, store)).orderBy(desc(posSales.createdAt)).limit(lim)
    : await db.select().from(posSales).orderBy(desc(posSales.createdAt)).limit(lim);
  return rows.map(rowToSale);
}

export async function listUnpostedPosSalesCore(store: string, limit = 200): Promise<Sale[]> {
  const db = getDb();
  const lim = Math.max(1, Math.min(1000, Number(limit) || 200));
  const cond = store
    ? and(eq(posSales.cancelled, false), eq(posSales.srsPosted, false), eq(posSales.store, store))
    : and(eq(posSales.cancelled, false), eq(posSales.srsPosted, false));
  const rows = await db.select().from(posSales).where(cond).orderBy(desc(posSales.createdAt)).limit(lim);
  return rows.map(rowToSale);
}

/** Verkopen van een winkel binnen een created_at-venster (UTC) — voor de
 *  dagafsluiting/kasstaat (die filtert daarna exact op Amsterdam-dag). */
export async function listPosSalesByRangeCore(store: string, fromIso: string, toIso: string): Promise<Sale[]> {
  if (!store || !fromIso || !toIso) return [];
  const db = getDb();
  const rows = await db.select().from(posSales)
    .where(and(eq(posSales.store, store), gte(posSales.createdAt, new Date(fromIso)), lt(posSales.createdAt, new Date(toIso))))
    .orderBy(desc(posSales.createdAt)).limit(5000);
  return rows.map(rowToSale);
}

export async function getPosSaleCore(id: string): Promise<Sale | null> {
  if (!id) return null;
  const db = getDb();
  const [r] = await db.select().from(posSales).where(eq(posSales.id, String(id))).limit(1);
  return r ? rowToSale(r) : null;
}

/**
 * Bonnen van één klant — voor de klant-historie in de kassa ("de bon aan de klant koppelen").
 * Matcht op het opgeslagen customer_id ÉN (uit de data-jsonb) het e-mailadres, zodat een
 * verkoop óók wordt gevonden als de kassa destijds alleen het e-mail koppelde. Alleen
 * niet-geannuleerde bonnen, nieuwste eerst.
 */
export async function listPosSalesByCustomerCore(input: { customerId?: string; email?: string; limit?: number }): Promise<Sale[]> {
  const cid = String(input.customerId || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  if (!cid && !email) return [];
  const db = getDb();
  const lim = Math.max(1, Math.min(100, Number(input.limit) || 25));
  const ors = [];
  if (cid) ors.push(eq(posSales.customerId, cid));
  if (email) ors.push(sql`lower(${posSales.data} ->> 'customerEmail') = ${email}`);
  const rows = await db
    .select()
    .from(posSales)
    .where(and(eq(posSales.cancelled, false), or(...ors)))
    .orderBy(desc(posSales.createdAt))
    .limit(lim);
  return rows.map(rowToSale);
}

/**
 * Koppel een klant achteraf aan een bestaande bon (klant kocht zonder z'n profiel te koppelen).
 * IDEMPOTENT via een DB-guard: de update slaagt alléén als de bon nog geen customer_id had.
 *   assigned:true  → nieuw gekoppeld (de aanroeper mag nú de spaarpunten toekennen).
 *   assigned:false → had al een klant / race → NIET opnieuw toekennen.
 * Zet zowel de queryable kolom als het customerId/customer/customerEmail in de data-jsonb, zodat
 * de bon voortaan bij de klant-historie (listPosSalesByCustomerCore) verschijnt.
 */
export async function assignCustomerToSaleCore(saleId: string, customerId: string, name?: string, email?: string): Promise<{ ok: boolean; assigned: boolean; sale?: Sale; error?: string }> {
  const id = String(saleId || "").trim();
  const cid = String(customerId || "").trim();
  if (!id || !cid) return { ok: false, assigned: false, error: "saleId + customerId vereist." };
  const db = getDb();
  const [existing] = await db.select().from(posSales).where(eq(posSales.id, id)).limit(1);
  if (!existing) return { ok: false, assigned: false, error: "Bon niet gevonden." };
  const cur = rowToSale(existing) as Sale & { customerId?: string; customer?: string; customerEmail?: string };
  if (String(cur.customerId || "").trim()) return { ok: true, assigned: false, sale: cur }; // al gekoppeld

  const nm = String(name || "").trim();
  const em = String(email || "").trim();
  const newData = { ...(cur as object), customerId: cid, customer: nm || cur.customer || "", customerEmail: em || cur.customerEmail || "" };
  const [upd] = await db
    .update(posSales)
    .set({ customerId: cid, data: newData as object })
    .where(and(eq(posSales.id, id), eq(posSales.customerId, ""))) // guard: alleen als nog niet gekoppeld
    .returning();
  if (!upd) {
    const [again] = await db.select().from(posSales).where(eq(posSales.id, id)).limit(1);
    return { ok: true, assigned: false, sale: again ? rowToSale(again) : cur };
  }
  return { ok: true, assigned: true, sale: rowToSale(upd) };
}

export async function findSaleByClientRefCore(clientRef: string): Promise<Sale | null> {
  const ref = String(clientRef || "").trim();
  if (!ref) return null;
  const db = getDb();
  const [r] = await db.select().from(posSales).where(eq(posSales.clientRef, ref)).limit(1);
  return r ? rowToSale(r) : null;
}

/** Annuleer (soft-delete): kolom + data-JSONB consistent. */
export async function cancelPosSaleCore(id: string, actor: { name?: string } = {}): Promise<Sale | null> {
  const db = getDb();
  const [r] = await db.select().from(posSales).where(eq(posSales.id, String(id))).limit(1);
  if (!r) return null;
  const sale = rowToSale(r);
  if (sale.cancelled) return sale;
  const next: Sale = { ...sale, cancelled: true, cancelledAt: new Date().toISOString(), cancelledBy: String(actor?.name || "") };
  await db.update(posSales).set({ cancelled: true, data: next }).where(eq(posSales.id, String(id)));
  return next;
}

/** Markeer (deels) verrekend naar SRS. Idempotent: 'posted' niet nog eens. */
export async function markPosSaleSrsPostedCore(id: string, opts: { srsRef?: string; credSource?: string; status?: string; error?: string; force?: boolean } = {}): Promise<Sale | null> {
  const db = getDb();
  const [r] = await db.select().from(posSales).where(eq(posSales.id, String(id))).limit(1);
  if (!r) return null;
  const sale = rowToSale(r) as Sale & { srsPostStatus?: string; srsPostAttempts?: number };
  /* force = bonnummer-botsing herstellen (Rotterdam 6 aug): een 'posted'-markering
     met een nummer dat in SRS door een ándere bon bezet blijkt, moet overschreven
     kunnen worden met het nieuwe, wél geldige nummer. */
  if (!opts.force && sale.srsPosted && sale.srsPostStatus === "posted") return sale;
  const status = String(opts.status || "posted");
  const next: Sale = {
    ...sale, srsPosted: status === "posted", srsPostStatus: status, srsPostedAt: new Date().toISOString(),
    // srsRef nooit WISSEN bij een latere mislukte poging: het gereserveerde bonnr
    // is precies wat een herpost door de sweep ontdubbelbaar maakt.
    srsRef: opts.force ? String(opts.srsRef || "") : (String(opts.srsRef || "") || String((sale as { srsRef?: string }).srsRef || "")),
    srsCredSource: String(opts.credSource || ""), srsPostError: String(opts.error || ""),
    // Pogingteller — spiegelt de blob-store; de sweep leest Neon-first en strandt
    // een record na te veel mislukte pogingen i.p.v. eeuwig budget te verbranden.
    srsPostAttempts: status === "failed" ? (Number(sale.srsPostAttempts) || 0) + 1 : (Number(sale.srsPostAttempts) || 0),
  } as Sale;
  await db.update(posSales).set({ srsPosted: status === "posted", data: next }).where(eq(posSales.id, String(id)));
  return next;
}

/* ───── Over-retour-guard: atomische claim op de ORIGINELE bon ────────────────
   De guard stond in storegents in de blob-mutator en werd daar "atomisch"
   genoemd. Dat was hij niet: Vercel Blob heeft geen compare-and-swap en
   json-blob-store doet na vier pogingen een last-writer-wins-put. Twee
   gelijktijdige retouren op dezelfde bon konden dus samen meer terugnemen dan
   er verkocht is.

   Hier gebeurt het in ÉÉN statement op de originele bon-rij. Onder READ
   COMMITTED herevalueert Postgres de WHERE tegen de nieuwe rijversie als een
   andere transactie de rij intussen wijzigde (EvalPlanQual) — dat is echte
   compare-and-swap, óók over neon-http zonder transacties. Empirisch getoetst:
   10 gelijktijdige claims van 1 stuk op 2 verkocht leveren er precies 2 op.

   De geclaimde aantallen staan in data->'retourClaims' op de ORIGINELE bon, per
   regel-sleutel (sku → barcode → lowercase naam; spiegelt lineKey in storegents
   lib/pos-sales-store.js). ALLES-OF-NIETS: staat één gevraagde regel niet toe,
   dan wordt de hele claim geweigerd en is er niets geclaimd.

   Cadeaubon-VERKOOPregels tellen als 0 verkocht — die zijn nooit retourneerbaar
   (terugdraaien = de verkoop annuleren, dat deactiveert de bon). */

const REGEL_SLEUTEL = sql`coalesce(nullif(trim(l->>'sku'), ''), nullif(trim(l->>'barcode'), ''), lower(trim(l->>'name')))`;

/** Claim retour-aantallen op de originele bon. 0 rijen terug = geweigerd. */
export async function claimRetourCore(
  origSaleId: string,
  wanted: Record<string, number>,
): Promise<{ ok: boolean; claims?: Record<string, number>; error?: string }> {
  const id = String(origSaleId || "").trim();
  const schoon: Record<string, number> = {};
  for (const [k, v] of Object.entries(wanted || {})) {
    const n = Math.abs(Number(v) || 0);
    if (k && n > 0) schoon[k] = (schoon[k] || 0) + n;
  }
  if (!id) return { ok: false, error: "Geen originele bon." };
  if (!Object.keys(schoon).length) return { ok: false, error: "Geen retour-regels." };

  const rows = await getDb().execute<{ claims: Record<string, number> }>(sql`
    with gevraagd as (
      select key as k, value::numeric as want from jsonb_each_text(${JSON.stringify(schoon)}::jsonb)
    ),
    verkocht as (
      select ${REGEL_SLEUTEL} as k,
             sum(case when coalesce(l->>'lineType', '') = 'giftcard' then 0 else abs((l->>'qty')::numeric) end) as sold
      from pos_sales s, lateral jsonb_array_elements(s.data->'lines') l
      where s.id = ${id}
      group by 1
    )
    update pos_sales p
    set data = jsonb_set(
          p.data, '{retourClaims}',
          (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
             select coalesce(g.k, c.key) as k,
                    coalesce(c.value::numeric, 0) + coalesce(g.want, 0) as v
             from jsonb_each_text(coalesce(p.data->'retourClaims', '{}'::jsonb)) c
             full outer join gevraagd g on g.k = c.key
           ) t),
          true)
    where p.id = ${id}
      and p.cancelled = false
      and coalesce(p.data->>'kind', '') <> 'retour'
      and not exists (
        select 1 from gevraagd g
        left join verkocht v on v.k = g.k
        where coalesce(v.sold, 0) < g.want + coalesce((p.data->'retourClaims'->>g.k)::numeric, 0)
      )
    returning p.data->'retourClaims' as claims`);

  if (!rows.rows.length) {
    return { ok: false, error: "Deze regels zijn al (deels) geretourneerd, of de bon is geannuleerd/onbekend." };
  }
  return { ok: true, claims: rows.rows[0].claims };
}

/** Draai een eerder geslaagde claim terug (compensatie als het vastleggen erna faalt). */
export async function releaseRetourCore(origSaleId: string, wanted: Record<string, number>): Promise<boolean> {
  const id = String(origSaleId || "").trim();
  const schoon: Record<string, number> = {};
  for (const [k, v] of Object.entries(wanted || {})) {
    const n = Math.abs(Number(v) || 0);
    if (k && n > 0) schoon[k] = (schoon[k] || 0) + n;
  }
  if (!id || !Object.keys(schoon).length) return false;

  /* greatest(...,0) zodat een dubbele release nooit onder nul zakt — dat zou
     stilletjes extra retour-ruimte creëren. */
  const rows = await getDb().execute(sql`
    with terug as (
      select key as k, value::numeric as v from jsonb_each_text(${JSON.stringify(schoon)}::jsonb)
    )
    update pos_sales p
    set data = jsonb_set(
          p.data, '{retourClaims}',
          (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
             select c.key as k, greatest(c.value::numeric - coalesce(t.v, 0), 0) as v
             from jsonb_each_text(coalesce(p.data->'retourClaims', '{}'::jsonb)) c
             left join terug t on t.k = c.key
           ) x),
          true)
    where p.id = ${id}
    returning p.id`);
  return rows.rows.length > 0;
}
