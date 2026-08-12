import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { exactState } from "@/db/schema";

/**
 * Exact Online-koppelingsstatus in de Neon-core (vervangt de storegents-blobs
 * exact/*.json). Opzettelijk een domme key/value-laag: wát er in `value` staat
 * bepaalt storegents — de tokens komen hier al AES-versleuteld binnen, dus de
 * database ziet nooit een leesbare refresh-token.
 *
 * Het enige slimme stuk is het refresh-slot. Exacts refresh-token is EENMALIG:
 * verversen twee servers tegelijk, dan biedt de verliezer de al-gebruikte token
 * aan en trekt Exact de hele keten in (11-8-2026, "Old refresh token used").
 * Blob kon dat niet voorkomen — geen sloten. Hier is de claim één atomaire
 * INSERT ... ON CONFLICT ... WHERE: precies één winnaar per lease-venster.
 */

export async function getExactState(key: string): Promise<unknown | null> {
  const db = getDb();
  const rows = await db.select().from(exactState).where(eq(exactState.key, key)).limit(1);
  return rows.length ? rows[0].value : null;
}

export async function putExactState(key: string, value: unknown): Promise<void> {
  const db = getDb();
  await db
    .insert(exactState)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: exactState.key, set: { value, updatedAt: new Date() } });
}

export async function delExactState(key: string): Promise<void> {
  const db = getDb();
  await db.delete(exactState).where(eq(exactState.key, key));
}

const LOCK_KEY = "refresh-lock";

/**
 * Probeer het refresh-slot te claimen. Eén atomaire statement: de insert wint
 * als er nog geen slot is, de update wint alleen als de vorige lease verlopen
 * is. Geeft terug of DEZE aanroep de claim won — de verliezer gaat pollen op
 * verse tokens in plaats van zelf te verversen.
 */
export async function claimExactRefresh(owner: string, leaseMs: number): Promise<boolean> {
  const db = getDb();
  const now = Date.now();
  const value = { owner, until: now + Math.max(1000, leaseMs) };
  const rows = await db
    .insert(exactState)
    .values({ key: LOCK_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: exactState.key,
      set: { value, updatedAt: new Date() },
      setWhere: sql`coalesce((${exactState.value}->>'until')::bigint, 0) < ${now}`,
    })
    .returning({ key: exactState.key });
  return rows.length > 0;
}

/** Slot vrijgeven — alleen door de eigenaar (een verlopen lease valt vanzelf vrij). */
export async function releaseExactRefresh(owner: string): Promise<void> {
  const db = getDb();
  await db
    .update(exactState)
    .set({ value: { owner: "", until: 0 }, updatedAt: new Date() })
    .where(sql`${exactState.key} = ${LOCK_KEY} and ${exactState.value}->>'owner' = ${owner}`);
}
