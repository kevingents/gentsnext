import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { posOpenings } from "@/db/schema";

/**
 * Kas-openingen (beginkas-telling per winkel per dag) in de Neon-core —
 * bron-van-waarheid; vervangt de storegents-blob admin/kassa-openings.json.
 *
 * Semantiek gespiegeld aan de blob-store:
 *  - upsert per (store, date); een hertelling overschrijft mét audit-spoor
 *    (`previous`, max 10) en de SRS-boeking van de dag blijft staan (die hoort
 *    bij de DAG, niet bij de telling — anders lokt een hertelling een tweede
 *    `inkas`-boeking uit);
 *  - de SRS-claim (data->'srs') is hier ATOMAIR: één conditionele update wint,
 *    i.p.v. het read-modify-write-venster van de blob.
 */

type Opening = Record<string, unknown> & {
  store?: string; date?: string; amount?: number;
  actor?: unknown; countedAt?: string; previous?: unknown[];
  srs?: { bonnr?: string; amount?: number | null; claimedAt?: string } | null;
};

const MAX_PREVIOUS = 10;

function round2(n: unknown): number {
  const v = Number(n);
  return Math.round(((Number.isFinite(v) ? v : 0) + Number.EPSILON) * 100) / 100;
}

function rowToOpening(r: { data: unknown }): Opening {
  return (r?.data ?? {}) as Opening;
}

export async function getOpeningCore(store: string, date: string): Promise<Opening | null> {
  if (!store || !date) return null;
  const db = getDb();
  const [r] = await db.select().from(posOpenings).where(and(eq(posOpenings.store, store), eq(posOpenings.date, date))).limit(1);
  return r ? rowToOpening(r) : null;
}

/**
 * Leg de kas-opening vast — upsert per (store, date). Bij een hertelling wordt de
 * vorige telling als audit in `previous` bewaard en blijft een bestaande SRS-boeking
 * staan. NB: de previous-keten wordt met een read-then-upsert gebouwd; twee exact
 * gelijktijdige hertellingen kunnen elkaars audit-regel missen (zelfde venster als
 * de blob had) — het geldbedrag zelf is gewoon last-count-wins, zoals bedoeld.
 */
export async function recordOpeningCore(input: { store: string; date: string; opening?: Opening }): Promise<{ ok: boolean; opening?: Opening; error?: string }> {
  const store = String(input.store || "").trim();
  const date = String(input.date || "").trim();
  if (!store || !date) return { ok: false, error: "store + date vereist." };
  const opening: Opening = { ...(input.opening ?? {}), store, date };
  if (!Number.isFinite(Number(opening.amount))) return { ok: false, error: "Geldig beginkas-bedrag vereist." };
  opening.amount = round2(opening.amount);

  const db = getDb();
  const [existing] = await db.select().from(posOpenings).where(and(eq(posOpenings.store, store), eq(posOpenings.date, date))).limit(1);
  if (existing) {
    const old = rowToOpening(existing);
    opening.previous = [
      { amount: round2(old.amount), actor: old.actor ?? null, countedAt: old.countedAt ?? null },
      ...(Array.isArray(old.previous) ? old.previous : []),
    ].slice(0, MAX_PREVIOUS);
    /* De SRS-boeking hoort bij de DAG, niet bij de telling. */
    if (old.srs) opening.srs = old.srs;
  }

  const values = {
    store,
    date,
    amountCents: Math.round((Number(opening.amount) || 0) * 100),
    data: opening,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(posOpenings)
    .values(values)
    .onConflictDoUpdate({
      target: [posOpenings.store, posOpenings.date],
      set: { amountCents: values.amountCents, data: values.data, updatedAt: values.updatedAt },
    })
    .returning();
  return { ok: true, opening: rowToOpening(row) };
}

/**
 * ATOMAIRE SRS-claim: zet data->'srs' alléén als die er nog niet is — één
 * conditionele update, dus er wint er precies één. Geen telling = niets te
 * claimen ('mislukt'), claim/boeking aanwezig = 'al-bezet'.
 */
export async function claimOpeningSrsCore(store: string, date: string): Promise<"geclaimd" | "al-bezet" | "mislukt"> {
  if (!store || !date) return "mislukt";
  const db = getDb();
  const claim = { bonnr: "", amount: null, claimedAt: new Date().toISOString() };
  const res = await db
    .update(posOpenings)
    .set({ data: sql`jsonb_set(${posOpenings.data}, '{srs}', ${JSON.stringify(claim)}::jsonb)`, updatedAt: new Date() })
    .where(and(eq(posOpenings.store, store), eq(posOpenings.date, date), sql`${posOpenings.data} -> 'srs' is null`))
    .returning({ id: posOpenings.id });
  if (res.length) return "geclaimd";
  const [row] = await db.select().from(posOpenings).where(and(eq(posOpenings.store, store), eq(posOpenings.date, date))).limit(1);
  if (!row) return "mislukt"; // geen telling = niets te claimen
  return rowToOpening(row).srs ? "al-bezet" : "mislukt";
}

/**
 * Geef de claim terug — alléén een claim ZONDER bonnummer (een claim mét bonnummer
 * is een echte SRS-boeking; die geven we nooit vrij).
 */
export async function releaseOpeningSrsCore(store: string, date: string): Promise<{ ok: boolean; released: boolean }> {
  if (!store || !date) return { ok: false, released: false };
  const db = getDb();
  const res = await db
    .update(posOpenings)
    .set({ data: sql`${posOpenings.data} - 'srs'`, updatedAt: new Date() })
    .where(and(
      eq(posOpenings.store, store),
      eq(posOpenings.date, date),
      sql`${posOpenings.data} -> 'srs' is not null and coalesce(${posOpenings.data} #>> '{srs,bonnr}', '') = ''`,
    ))
    .returning({ id: posOpenings.id });
  return { ok: true, released: res.length > 0 };
}

/**
 * Vul de claim aan met het SRS-bonnummer. Alleen een claim ZONDER bonnummer wordt
 * ingevuld — een al ingevuld bonnummer is de bon die echt in SRS staat en die
 * overschrijven we nooit. Retourneert de stempel, of null als er niets is ingevuld.
 */
export async function markOpeningSrsCore(store: string, date: string, srs: { bonnr?: string; amount?: number } = {}): Promise<{ bonnr: string; amount: number; boektAt: string } | null> {
  const bonnr = String(srs?.bonnr || "").trim();
  if (!store || !date || !bonnr) return null;
  const stempel = { bonnr, amount: round2(srs.amount), boektAt: new Date().toISOString() };
  const db = getDb();
  const res = await db
    .update(posOpenings)
    .set({
      data: sql`jsonb_set(${posOpenings.data}, '{srs}', coalesce(${posOpenings.data} -> 'srs', '{}'::jsonb) || ${JSON.stringify(stempel)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(posOpenings.store, store),
      eq(posOpenings.date, date),
      sql`coalesce(${posOpenings.data} #>> '{srs,bonnr}', '') = ''`,
    ))
    .returning({ id: posOpenings.id });
  return res.length ? stempel : null;
}

/** Eenmalige blob→Neon-backfill: alleen invoegen wat er nog niet staat (historie
 *  incl. srs-stempels blijft intact; een al in Neon bijgewerkte dag wint altijd). */
export async function backfillOpeningsCore(openings: Opening[]): Promise<{ ok: boolean; inserted: number }> {
  const rows = (Array.isArray(openings) ? openings : [])
    .filter((o) => String(o?.store || "").trim() && String(o?.date || "").trim())
    .map((o) => ({
      store: String(o.store || "").trim(),
      date: String(o.date || "").trim(),
      amountCents: Math.round((Number(o.amount) || 0) * 100),
      data: o,
      updatedAt: new Date(),
    }));
  const db = getDb();
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const res = await db.insert(posOpenings).values(rows.slice(i, i + 200)).onConflictDoNothing().returning({ id: posOpenings.id });
    inserted += res.length;
  }
  return { ok: true, inserted };
}
