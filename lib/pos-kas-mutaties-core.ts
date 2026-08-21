import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { posKasMutaties } from "@/db/schema";

/**
 * Kasmutaties (in/uit kas, in/uit kluis) in de Neon-core — bron-van-waarheid;
 * vervangt de storegents-blob admin/pos-kas-mutaties.json. Dit is een GELDSPOOR:
 * append-only (fout ingevoerd = tegenmutatie boeken) en zonder blob-cap. De
 * storegents-validatie (types, bedragsgrenzen, reden-verplicht) blijft dáár; hier
 * slaan we het gevalideerde record op + lezen we het terug. Idempotent op id,
 * zodat een retry of de eenmalige blob-backfill nooit dubbel boekt.
 */

type Mutatie = Record<string, unknown> & { id?: string; store?: string; date?: string; type?: string };

/* Moet elk type kennen dat storegents boekt — een type dat hier ontbreekt wordt
   geweigerd en belandt dan alleen in de blob-spiegel (coreSyncFailed), waarna de
   kassa-lijst 'm niet meer toont: die leest Neon-first. Zo verdween de eerste
   sealbag-uit van Den Bosch (21 aug, € 2.950) uit beeld terwijl 'ie wel geboekt
   was. kluis-sealbag = kluis → waardetransport (lade ongemoeid, kluis −). */
const TYPES = ["inkas", "uitkas", "kluis-in", "kluis-uit", "kluis-sealbag"];

function rowToMutatie(r: { data: unknown }): Mutatie {
  return (r?.data ?? {}) as Mutatie;
}

function colsFromMutatie(m: Mutatie) {
  return {
    id: String(m.id || ""),
    store: String(m.store || ""),
    date: String(m.date || ""),
    type: String(m.type || ""),
    amountCents: Math.round((Number((m as { amount?: number }).amount) || 0) * 100),
    data: m,
    createdAt: (m as { at?: string }).at ? new Date(String((m as { at?: string }).at)) : new Date(),
  };
}

/** Leg een kasmutatie vast. Append-only; idempotent op id (retry boekt nooit dubbel). */
export async function recordKasMutatieCore(mutatie: Mutatie): Promise<{ ok: boolean; mutatie?: Mutatie; deduped?: boolean; error?: string }> {
  const row = colsFromMutatie(mutatie || {});
  if (!row.id || !row.store || !row.date) return { ok: false, error: "Ongeldige mutatie (id + store + date vereist)." };
  if (!TYPES.includes(row.type)) return { ok: false, error: `Onbekend mutatietype "${row.type}".` };
  if (!(row.amountCents > 0)) return { ok: false, error: "Bedrag moet boven € 0 zijn." };
  const db = getDb();
  const [ins] = await db.insert(posKasMutaties).values(row).onConflictDoNothing().returning();
  if (ins) return { ok: true, mutatie: rowToMutatie(ins) };
  const [existing] = await db.select().from(posKasMutaties).where(eq(posKasMutaties.id, row.id)).limit(1);
  return { ok: true, mutatie: existing ? rowToMutatie(existing) : mutatie, deduped: true };
}

/** Mutaties van (winkel, datum), nieuwste eerst. */
export async function listKasMutatiesCore(store: string, date: string): Promise<Mutatie[]> {
  const s = String(store || "").trim();
  const d = String(date || "").trim();
  if (!s || !d) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(posKasMutaties)
    .where(and(eq(posKasMutaties.store, s), eq(posKasMutaties.date, d)))
    .orderBy(desc(posKasMutaties.createdAt))
    .limit(1000);
  return rows.map(rowToMutatie);
}

/**
 * Hang een factuur/bon-bijlage aan een bestaande uitkas-mutatie. De kassa belooft
 * bij het boeken "mag ook later" — dit is dat later. GEEN geldwijziging (bedrag,
 * type, datum en actor blijven onaantastbaar; het spoor blijft append-only voor
 * geld), alleen het `bon`-blok in de jsonb plus wie/wanneer 'm naleverde.
 * Eén keer: zit er al een bon aan, dan weigeren — een boekstuk-bijlage stilletjes
 * vervangen is bewijs vervangen; fout bestand = melden bij kantoor.
 */
export async function attachKasBonCore(
  id: string,
  bon: { url?: string; naam?: string; type?: string; grootte?: number | null },
  door: { name?: string; userId?: string },
): Promise<{ ok: boolean; mutatie?: Mutatie; error?: string }> {
  const mid = String(id || "").trim();
  const url = String(bon?.url || "").trim();
  if (!mid) return { ok: false, error: "Geen mutatie-id." };
  if (!url) return { ok: false, error: "Geen bon-URL." };
  const db = getDb();
  const [row] = await db.select().from(posKasMutaties).where(eq(posKasMutaties.id, mid)).limit(1);
  if (!row) return { ok: false, error: "Mutatie niet gevonden." };
  const data = rowToMutatie(row);
  if (String(data.type || row.type) !== "uitkas") return { ok: false, error: "Alleen een uit-kas-boeking draagt een factuur." };
  const bestaand = (data as { bon?: { url?: string } }).bon;
  if (bestaand && String(bestaand.url || "").trim()) return { ok: false, error: "Deze boeking heeft al een factuur." };

  const nieuw: Mutatie = {
    ...data,
    bon: {
      url,
      naam: String(bon?.naam || "").slice(0, 200),
      type: String(bon?.type || ""),
      grootte: Number.isFinite(Number(bon?.grootte)) ? Number(bon?.grootte) : null,
    },
    bonToegevoegd: {
      door: { name: String(door?.name || ""), userId: String(door?.userId || "") },
      op: new Date().toISOString(),
    },
  };
  /* Guard in de WHERE herhaald: twee gelijktijdige naleveringen mogen elkaar niet
     overschrijven — alleen de eerste vindt nog een rij zonder bon-url. */
  const [upd] = await db
    .update(posKasMutaties)
    .set({ data: nieuw })
    .where(and(eq(posKasMutaties.id, mid), sql`coalesce(${posKasMutaties.data}->'bon'->>'url', '') = ''`))
    .returning();
  if (!upd) return { ok: false, error: "Deze boeking heeft al een factuur." };
  return { ok: true, mutatie: rowToMutatie(upd) };
}

/** Eenmalige blob→Neon-backfill: alles invoegen dat er nog niet staat (idempotent op id). */
export async function backfillKasMutatiesCore(mutaties: Mutatie[]): Promise<{ ok: boolean; inserted: number }> {
  const rows = (Array.isArray(mutaties) ? mutaties : [])
    .map(colsFromMutatie)
    .filter((r) => r.id && r.store && r.date && TYPES.includes(r.type));
  const db = getDb();
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const res = await db.insert(posKasMutaties).values(rows.slice(i, i + 200)).onConflictDoNothing().returning({ id: posKasMutaties.id });
    inserted += res.length;
  }
  return { ok: true, inserted };
}
