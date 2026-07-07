import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";

/**
 * Voorraad-reservering Fase 0 — reconcile + drift-meting (observability, geen
 * gedragswijziging).
 *
 * De anti-oversell-gate (lib/store-reserve) houdt web_stock_reservation_counter.reserved
 * en de som van actieve web_stock_holds ATOMISCH gelijk (één CTE-statement per claim).
 * De opruim-/vrijgeef-paden (sweepExpiredHolds, releaseOrderHolds) zijn echter
 * best-effort (catch{}): faalt daar de teller-decrement terwijl de hold-DELETE lukt
 * (of andersom), dan drijft `reserved` weg van de werkelijke holds. Een te HOGE
 * reserved reserveert spookvoorraad (toont onterecht uitverkocht); een te LAGE geeft
 * oversell-risico.
 *
 * Deze reconcile herijkt `reserved` op de som van de nog-actieve holds. De correctie
 * herberekent die som BINNEN het UPDATE-statement (niet uit een eerder gemeten waarde),
 * zodat een claim die tussen meten en corrigeren binnenkomt niet wordt overschreven:
 * de gate schrijft hold + teller samen weg, dus een verse hold zit al in de SUM.
 * Absolute SET (geen increment) → idempotent, geen lock nodig.
 *
 * Per run wordt een drift-meetpunt bewaard (app_settings `stock:reservation-drift`,
 * rollende historie) zodat het portal kan tonen hoe vaak/hoeveel de teller wegliep —
 * de nulmeting vóór we de kassa door dezelfde gate laten lopen (Fase 1).
 */

const DRIFT_KEY = "stock:reservation-drift";
const MAX_POINTS = 288; // ~2 dagen bij een 10-min-cron

export type DriftSample = { location: string; stockKey: string; was: number; now: number };
export type ReconcileResult = {
  checkedRows: number; // tellers met reserved > 0 of met holds
  driftedRows: number; // tellers die niet klopten
  totalDriftAbs: number; // som |reserved − holds| over alle gedrifte rijen
  corrected: number; // daadwerkelijk bijgestelde rijen
  samples: DriftSample[]; // tot 10 grootste afwijkingen (voor de log/portal)
};

export type DriftPoint = {
  at: string; // ISO
  checkedRows: number;
  driftedRows: number;
  totalDriftAbs: number;
  corrected: number;
  worst: DriftSample[]; // tot 5 grootste
};

/**
 * Meet + corrigeer de drift tussen web_stock_reservation_counter.reserved en de som
 * van de actieve holds. Best-effort: gooit nooit (de cron mag hier niet op klappen).
 */
export async function reconcileReservationCounters(): Promise<ReconcileResult> {
  const empty: ReconcileResult = { checkedRows: 0, driftedRows: 0, totalDriftAbs: 0, corrected: 0, samples: [] };
  const db = getDb();

  // 1) METEN — per teller: reserved vs de som van nog-actieve holds. Alleen rijen
  //    die ertoe doen (reserved > 0 óf er zijn holds). Grootste afwijkingen eerst.
  let samples: DriftSample[] = [];
  let driftedRows = 0;
  let totalDriftAbs = 0;
  let checkedRows = 0;
  try {
    const measured = await db.execute<{ location: string; stock_key: string; reserved: number; held: number }>(sql`
      with actual as (
        select
          c.location,
          c.stock_key,
          c.reserved,
          coalesce((
            select sum(h.qty)::int from web_stock_holds h
            where h.location = c.location and h.stock_key = c.stock_key and h.expires_at > now()
          ), 0) as held
        from web_stock_reservation_counter c
        where c.reserved <> 0
           or exists (
             select 1 from web_stock_holds h
             where h.location = c.location and h.stock_key = c.stock_key and h.expires_at > now()
           )
      )
      select location, stock_key, reserved, held from actual
    `);
    for (const r of measured.rows) {
      checkedRows += 1;
      const reserved = Number(r.reserved) || 0;
      const held = Number(r.held) || 0;
      if (reserved !== held) {
        driftedRows += 1;
        totalDriftAbs += Math.abs(reserved - held);
        samples.push({ location: r.location, stockKey: r.stock_key, was: reserved, now: held });
      }
    }
    samples.sort((a, b) => Math.abs(b.was - b.now) - Math.abs(a.was - a.now));
    samples = samples.slice(0, 10);
  } catch {
    // Meting is puur observability; bij een leesfout gewoon niets rapporteren.
    return empty;
  }

  // 2) CORRIGEREN — herbereken de som BINNEN het statement (veilig t.o.v. een
  //    gelijktijdige claim) en zet reserved daarop; alleen rijen die afwijken.
  let corrected = 0;
  if (driftedRows > 0) {
    try {
      const upd = await db.execute<{ location: string }>(sql`
        update web_stock_reservation_counter c
        set reserved = coalesce((
              select sum(h.qty)::int from web_stock_holds h
              where h.location = c.location and h.stock_key = c.stock_key and h.expires_at > now()
            ), 0),
            updated_at = now()
        where c.reserved <> coalesce((
              select sum(h.qty)::int from web_stock_holds h
              where h.location = c.location and h.stock_key = c.stock_key and h.expires_at > now()
            ), 0)
        returning location
      `);
      corrected = upd.rows.length;
    } catch {
      // Correctie best-effort: de meting is al gelogd; volgende run probeert opnieuw.
    }
  }

  const result: ReconcileResult = { checkedRows, driftedRows, totalDriftAbs, corrected, samples };
  await recordDriftPoint(result).catch(() => {});
  return result;
}

/** Bewaar een drift-meetpunt in een rollende historie (app_settings). */
async function recordDriftPoint(r: ReconcileResult): Promise<void> {
  const db = getDb();
  const point: DriftPoint = {
    at: new Date().toISOString(),
    checkedRows: r.checkedRows,
    driftedRows: r.driftedRows,
    totalDriftAbs: r.totalDriftAbs,
    corrected: r.corrected,
    worst: r.samples.slice(0, 5),
  };
  const rows = await db.select().from(appSettings).where(sql`id = ${DRIFT_KEY}`).limit(1);
  const prev = (rows[0]?.data as { points?: DriftPoint[] } | undefined)?.points ?? [];
  const points = [...prev, point].slice(-MAX_POINTS);
  await db
    .insert(appSettings)
    .values({ id: DRIFT_KEY, data: { points } as unknown, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: { points } as unknown, updatedAt: sql`now()` } });
}

/** Lees de drift-historie (voor het portal / een status-endpoint). */
export async function getDriftHistory(): Promise<DriftPoint[]> {
  try {
    const db = getDb();
    const rows = await db.select().from(appSettings).where(sql`id = ${DRIFT_KEY}`).limit(1);
    return (rows[0]?.data as { points?: DriftPoint[] } | undefined)?.points ?? [];
  } catch {
    return [];
  }
}
