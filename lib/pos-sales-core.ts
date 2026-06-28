import { and, desc, eq, sql } from "drizzle-orm";
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

export async function getPosSaleCore(id: string): Promise<Sale | null> {
  if (!id) return null;
  const db = getDb();
  const [r] = await db.select().from(posSales).where(eq(posSales.id, String(id))).limit(1);
  return r ? rowToSale(r) : null;
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
export async function markPosSaleSrsPostedCore(id: string, opts: { srsRef?: string; credSource?: string; status?: string; error?: string } = {}): Promise<Sale | null> {
  const db = getDb();
  const [r] = await db.select().from(posSales).where(eq(posSales.id, String(id))).limit(1);
  if (!r) return null;
  const sale = rowToSale(r) as Sale & { srsPostStatus?: string };
  if (sale.srsPosted && sale.srsPostStatus === "posted") return sale;
  const status = String(opts.status || "posted");
  const next: Sale = {
    ...sale, srsPosted: status === "posted", srsPostStatus: status, srsPostedAt: new Date().toISOString(),
    srsRef: String(opts.srsRef || ""), srsCredSource: String(opts.credSource || ""), srsPostError: String(opts.error || ""),
  };
  await db.update(posSales).set({ srsPosted: status === "posted", data: next }).where(eq(posSales.id, String(id)));
  return next;
}
