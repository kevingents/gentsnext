import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { storePrintJobs } from "@/db/schema";

/**
 * Print-inbox: de backend kan een winkel-kassa niet direct laten printen (de agent zit op
 * localhost achter NAT), dus print-opdrachten worden per winkel gequeued. De kassa van die
 * winkel pollt de inbox, print elke opdracht via z'n lokale agent en ackt 'm. Gebruikt voor
 * de winkel→winkel-uitwisseling: de bronwinkel krijgt een pick-opdracht met scanbare barcode.
 */

export type PrintJob = {
  id: string;
  store: string;
  type: string;
  ref: string;
  payload: unknown;
  status: string;
  createdAt: string;
};

const norm = (v: unknown) => String(v ?? "").trim();

function toJob(r: typeof storePrintJobs.$inferSelect): PrintJob {
  return {
    id: r.id,
    store: r.store,
    type: r.type,
    ref: r.ref,
    payload: r.payload,
    status: r.status,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

/** Zet een print-opdracht in de wachtrij. Idempotent op (store, ref, type) als er een ref is
 *  (dubbel-aanvragen queuet niet dubbel; re-queue reset 'm naar pending). */
export async function enqueuePrintJob(input: {
  store: string; type?: string; ref?: string; payload?: unknown; createdBy?: string;
}): Promise<{ ok: boolean; job?: PrintJob; error?: string }> {
  const store = norm(input.store);
  if (!store) return { ok: false, error: "store vereist." };
  const db = getDb();
  const values = {
    store,
    type: norm(input.type) || "pick",
    ref: norm(input.ref),
    payload: (input.payload ?? {}) as object,
    createdBy: norm(input.createdBy),
    status: "pending",
  };
  if (values.ref) {
    const [row] = await db
      .insert(storePrintJobs)
      .values(values)
      .onConflictDoUpdate({
        target: [storePrintJobs.store, storePrintJobs.ref, storePrintJobs.type],
        targetWhere: sql`ref <> ''`,
        set: { payload: values.payload, status: "pending", printedAt: null, createdBy: values.createdBy },
      })
      .returning();
    return { ok: true, job: toJob(row) };
  }
  const [row] = await db.insert(storePrintJobs).values(values).returning();
  return { ok: true, job: toJob(row) };
}

/** Openstaande print-opdrachten voor een winkel (oudste eerst → printvolgorde). */
export async function pendingPrintJobs(store: string, limit = 20): Promise<PrintJob[]> {
  const s = norm(store);
  if (!s) return [];
  const db = getDb();
  const lim = Math.max(1, Math.min(50, Number(limit) || 20));
  const rows = await db
    .select()
    .from(storePrintJobs)
    .where(and(eq(storePrintJobs.store, s), eq(storePrintJobs.status, "pending")))
    .orderBy(desc(storePrintJobs.createdAt))
    .limit(lim);
  return rows.reverse().map(toJob); // oudste eerst
}

/** Markeer een opdracht als geprint (kassa heeft 'm naar de agent gestuurd). */
export async function markPrintJobDone(id: string, store: string): Promise<{ ok: boolean }> {
  const jobId = norm(id);
  const s = norm(store);
  if (!jobId || !s) return { ok: false };
  const db = getDb();
  await db
    .update(storePrintJobs)
    .set({ status: "printed", printedAt: new Date() })
    .where(and(eq(storePrintJobs.id, jobId), eq(storePrintJobs.store, s)));
  return { ok: true };
}
