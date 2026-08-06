import { and, desc, eq, lt, sql } from "drizzle-orm";
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
 *  (dubbel-aanvragen queuet niet dubbel; re-queue reset 'm naar pending).
 *  mode 'once' = alléén enqueuen als deze (store, ref, type) er nog NOOIT was: een al
 *  geprinte job blijft geprint. Voor bewakers die herhaald draaien (keukenbon: de
 *  store-orders-poll ziet dezelfde open order elke minuut — die mag maar 1× uit de
 *  printer rollen, niet bij elke poll opnieuw).
 *  NB: een VERVALLEN opdracht (zie pendingPrintJobs) telt ook als "is aangeboden" en
 *  komt dus niet terug. Bewust: gaat een winkel later alsnog live, dan wil je z'n
 *  bestaande werkvoorraad niet als bonnenstapel uit de printer krijgen — die orders
 *  staan gewoon in het orderscherm. Alleen nieuw werk rolt eruit. */
export async function enqueuePrintJob(input: {
  store: string; type?: string; ref?: string; payload?: unknown; createdBy?: string; mode?: "once";
}): Promise<{ ok: boolean; job?: PrintJob; deduped?: boolean; error?: string }> {
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
    if (input.mode === "once") {
      const rows = await db
        .insert(storePrintJobs)
        .values(values)
        .onConflictDoNothing({
          target: [storePrintJobs.store, storePrintJobs.ref, storePrintJobs.type],
          where: sql`ref <> ''`,
        })
        .returning();
      return rows[0] ? { ok: true, job: toJob(rows[0]) } : { ok: true, deduped: true };
    }
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

/* Hoe lang een niet-opgehaalde opdracht nog geprint mag worden. Winkels zonder
   (draaiende) kassa halen hun opdrachten nooit op — die stapelden onbeperkt op:
   op 6 aug stonden er 8 voor Breda met een oudste van 7 maart. Zonder deze grens
   rolt bij het live gaan van zo'n winkel in één klap een stapel maanden oude
   bonnen uit de printer. Een pakbon of keukenbon van gisteren heeft geen waarde
   meer; de order staat gewoon in het orderscherm. */
const VERVAL_UREN = 24;

/** Openstaande print-opdrachten voor een winkel (oudste eerst → printvolgorde).
 *  Opdrachten ouder dan VERVAL_UREN worden niet meer uitgeleverd én meteen als
 *  'expired' weggezet, zodat de wachtrij zichzelf opruimt (geen aparte cron). */
export async function pendingPrintJobs(store: string, limit = 20): Promise<PrintJob[]> {
  const s = norm(store);
  if (!s) return [];
  const db = getDb();
  const lim = Math.max(1, Math.min(50, Number(limit) || 20));
  const grens = new Date(Date.now() - VERVAL_UREN * 3600_000);

  await db
    .update(storePrintJobs)
    .set({ status: "expired" })
    .where(and(eq(storePrintJobs.store, s), eq(storePrintJobs.status, "pending"), lt(storePrintJobs.createdAt, grens)));

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
