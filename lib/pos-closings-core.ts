import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { posClosings } from "@/db/schema";

/**
 * Kassa-dagafsluitingen in de Neon-core (bron-van-waarheid; vervangt de storegents-
 * blob admin/kassa-closings.json). Atomaire upsert op (store, date) → geen read-
 * modify-write-race meer. De storegents-rekenlogica (kasstaat/kasopmaak) blijft
 * onveranderd; hier slaan we het resultaat op + lezen we het terug.
 */

export type Closing = {
  store: string;
  date: string;
  dagstaat: unknown;
  kasopmaak: unknown;
  note: string;
  actor: unknown;
  closedAt: string;
  mailedAt: string | null;
  mailStatus: string;
};

function rowToClosing(r: typeof posClosings.$inferSelect): Closing {
  return {
    store: r.store,
    date: r.date,
    dagstaat: r.dagstaat,
    kasopmaak: r.kasopmaak,
    note: r.note,
    actor: r.actor,
    closedAt: r.closedAt instanceof Date ? r.closedAt.toISOString() : String(r.closedAt),
    mailedAt: r.mailedAt instanceof Date ? r.mailedAt.toISOString() : null,
    mailStatus: r.mailStatus || "",
  };
}

/** Leg de dagafsluiting vast — upsert per (store, date), atomair. */
export async function recordClosingCore(input: {
  store: string; date: string; dagstaat?: unknown; kasopmaak?: unknown; note?: string; actor?: unknown; closedAt?: string;
}): Promise<{ ok: boolean; closing?: Closing; error?: string }> {
  const store = String(input.store || "").trim();
  const date = String(input.date || "").trim();
  if (!store || !date) return { ok: false, error: "store + date vereist." };
  const db = getDb();
  const closedAt = input.closedAt ? new Date(input.closedAt) : new Date();
  const values = {
    store,
    date,
    dagstaat: (input.dagstaat ?? {}) as object,
    kasopmaak: (input.kasopmaak ?? {}) as object,
    note: String(input.note || ""),
    actor: (input.actor ?? {}) as object,
    closedAt,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(posClosings)
    .values(values)
    .onConflictDoUpdate({
      target: [posClosings.store, posClosings.date],
      set: {
        dagstaat: values.dagstaat,
        kasopmaak: values.kasopmaak,
        note: values.note,
        actor: values.actor,
        closedAt,
        updatedAt: new Date(),
      },
    })
    .returning();
  return { ok: true, closing: rowToClosing(row) };
}

export async function getClosingCore(store: string, date: string): Promise<Closing | null> {
  if (!store || !date) return null;
  const db = getDb();
  const [r] = await db.select().from(posClosings).where(and(eq(posClosings.store, store), eq(posClosings.date, date))).limit(1);
  return r ? rowToClosing(r) : null;
}

export async function getLastClosingCore(store: string): Promise<Closing | null> {
  if (!store) return null;
  const db = getDb();
  const [r] = await db.select().from(posClosings).where(eq(posClosings.store, store)).orderBy(desc(posClosings.date)).limit(1);
  return r ? rowToClosing(r) : null;
}

export async function listClosingsCore(store: string, limit = 30): Promise<Closing[]> {
  if (!store) return [];
  const db = getDb();
  const lim = Math.max(1, Math.min(180, Number(limit) || 30));
  const rows = await db.select().from(posClosings).where(eq(posClosings.store, store)).orderBy(desc(posClosings.date)).limit(lim);
  return rows.map(rowToClosing);
}

/** Atomaire mail-status-update (aparte rij-update → geen clobber van de afsluiting). */
export async function markClosingMailedCore(store: string, date: string, opts: { status?: string } = {}): Promise<{ ok: boolean }> {
  if (!store || !date) return { ok: false };
  const db = getDb();
  await db
    .update(posClosings)
    .set({ mailedAt: new Date(), mailStatus: String(opts.status || "sent"), updatedAt: new Date() })
    .where(and(eq(posClosings.store, store), eq(posClosings.date, date)));
  return { ok: true };
}

/** Afsluitingen voor het HQ-overzicht: alle winkels, vanaf een datum (YYYY-MM-DD). */
export async function listClosingsForStoresCore(stores: string[], since: string): Promise<Closing[]> {
  const list = [...new Set((stores || []).map((s) => String(s || "").trim()).filter(Boolean))];
  if (!list.length) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(posClosings)
    .where(since ? and(inArray(posClosings.store, list), gte(posClosings.date, since)) : inArray(posClosings.store, list))
    .orderBy(desc(posClosings.date));
  return rows.map(rowToClosing);
}
