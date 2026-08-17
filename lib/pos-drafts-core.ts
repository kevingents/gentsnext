import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { posDrafts } from "@/db/schema";

/**
 * Geparkeerde kassa-mandjes (held sales / drafts) in de Neon-core —
 * bron-van-waarheid; vervangt de storegents-blob admin/pos-sales-drafts.json.
 * De prijsberekening (priceCart) blijft in storegents; hier slaan we het
 * doorberekende concept op als jsonb `data` + queryable kolommen. Upsert op id.
 */

type Draft = Record<string, unknown> & { id?: string; store?: string; createdAt?: string; updatedAt?: string };

function rowToDraft(r: { data: unknown }): Draft {
  return (r?.data ?? {}) as Draft;
}

function colsFromDraft(d: Draft) {
  return {
    id: String(d.id || ""),
    store: String(d.store || ""),
    data: d,
    createdAt: d.createdAt ? new Date(String(d.createdAt)) : new Date(),
    updatedAt: d.updatedAt ? new Date(String(d.updatedAt)) : new Date(),
  };
}

/** Sla een concept op — upsert op id (opnieuw parkeren overschrijft). */
export async function saveDraftCore(draft: Draft): Promise<{ ok: boolean; draft?: Draft; error?: string }> {
  const row = colsFromDraft(draft || {});
  if (!row.id || !row.store) return { ok: false, error: "Ongeldig concept (id + store vereist)." };
  const db = getDb();
  const [saved] = await db
    .insert(posDrafts)
    .values(row)
    .onConflictDoUpdate({ target: posDrafts.id, set: { store: row.store, data: row.data, updatedAt: row.updatedAt } })
    .returning();
  return { ok: true, draft: rowToDraft(saved) };
}

/** Geparkeerde mandjes (van één winkel, of alle), nieuwste eerst. */
export async function listDraftsCore(store: string, limit = 50): Promise<Draft[]> {
  const db = getDb();
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = store
    ? await db.select().from(posDrafts).where(eq(posDrafts.store, store)).orderBy(desc(posDrafts.updatedAt)).limit(lim)
    : await db.select().from(posDrafts).orderBy(desc(posDrafts.updatedAt)).limit(lim);
  return rows.map(rowToDraft);
}

export async function getDraftCore(id: string): Promise<Draft | null> {
  const did = String(id || "").trim();
  if (!did) return null;
  const db = getDb();
  const [r] = await db.select().from(posDrafts).where(eq(posDrafts.id, did)).limit(1);
  return r ? rowToDraft(r) : null;
}

/** Verwijder een concept (na laden in de cart of bij weggooien). */
export async function deleteDraftCore(id: string): Promise<{ ok: boolean; removed: boolean }> {
  const did = String(id || "").trim();
  if (!did) return { ok: true, removed: false };
  const db = getDb();
  const res = await db.delete(posDrafts).where(eq(posDrafts.id, did)).returning({ id: posDrafts.id });
  return { ok: true, removed: res.length > 0 };
}

/** Eenmalige blob→Neon-backfill: alleen invoegen wat er nog niet staat (een in
 *  Neon al bewerkt/verwijderd concept wordt nooit door een oude blob-kopie hersteld). */
export async function backfillDraftsCore(drafts: Draft[]): Promise<{ ok: boolean; inserted: number }> {
  const rows = (Array.isArray(drafts) ? drafts : [])
    .map(colsFromDraft)
    .filter((r) => r.id && r.store);
  const db = getDb();
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const res = await db.insert(posDrafts).values(rows.slice(i, i + 200)).onConflictDoNothing().returning({ id: posDrafts.id });
    inserted += res.length;
  }
  return { ok: true, inserted };
}
