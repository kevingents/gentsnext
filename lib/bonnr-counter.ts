import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/**
 * SRS-bonnummer per filiaal — ATOMAIR uit Neon.
 *
 * WAAROM (6 aug 2026, geld-incident Den Bosch): de teller stond in een Vercel-
 * blob. Twee verkopen 73 minuten na elkaar kregen allebei 900001 — de blob-lees
 * gaf een stale waarde (CDN-caching / read-after-write), dus de teller sprong
 * terug naar de startwaarde. SRS ontdubbelt op bonnummer: de tweede bon (€249,90)
 * werd stil genegeerd en stond niet in SRS. Verloren omzet zonder foutmelding.
 *
 * Eén SQL-statement is hier de hele oplossing: insert-or-increment met RETURNING
 * is atomair binnen Postgres, ook bij gelijktijdige kassa's. Geen race, geen
 * cache, geen stale read.
 *
 * De tabel wordt lui aangemaakt (create table if not exists) zodat dit werkt
 * zodra de deploy live is — ook vóór de migratie handmatig op prod draait
 * (migraties lopen hier bewust niet automatisch mee met de build).
 */

const START = 900001;

let tabelKlaar = false;

async function zorgVoorTabel(): Promise<void> {
  if (tabelKlaar) return;
  const db = getDb();
  await db.execute(sql`
    create table if not exists srs_bon_counters (
      filiaal text primary key,
      value integer not null,
      updated_at timestamptz not null default now()
    )
  `);
  tabelKlaar = true;
}

/**
 * Volgend bonnummer voor dit filiaal. Returnt null als Neon niet bereikbaar is —
 * de aanroeper valt dan terug op zijn eigen noodschema (nooit hard falen: de
 * kassa mag niet blokkeren op een teller).
 */
export async function nextBonnr(filiaal: string): Promise<number | null> {
  const fil = String(filiaal || "").trim();
  if (!fil) return null;
  try {
    await zorgVoorTabel();
    const db = getDb();
    const res = await db.execute<{ value: number }>(sql`
      insert into srs_bon_counters (filiaal, value)
      values (${fil}, ${START})
      on conflict (filiaal) do update
        set value = srs_bon_counters.value + 1, updated_at = now()
      returning value
    `);
    const v = Number(res.rows?.[0]?.value);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch (e) {
    console.warn("[bonnr-counter] Neon-teller niet beschikbaar:", (e as Error).message);
    return null;
  }
}

/**
 * Til de teller op naar minstens `minimum` (zonder een nummer uit te geven).
 * Voor de migratie van de blob-teller: de hoogste al uitgegeven waarde mag nooit
 * opnieuw uitgedeeld worden.
 */
export async function ensureAtLeast(filiaal: string, minimum: number): Promise<number | null> {
  const fil = String(filiaal || "").trim();
  const min = Math.floor(Number(minimum) || 0);
  if (!fil || min < START) return null;
  try {
    await zorgVoorTabel();
    const db = getDb();
    const res = await db.execute<{ value: number }>(sql`
      insert into srs_bon_counters (filiaal, value)
      values (${fil}, ${min})
      on conflict (filiaal) do update
        set value = greatest(srs_bon_counters.value, ${min}), updated_at = now()
      returning value
    `);
    const v = Number(res.rows?.[0]?.value);
    return Number.isFinite(v) ? v : null;
  } catch (e) {
    console.warn("[bonnr-counter] ensureAtLeast faalde:", (e as Error).message);
    return null;
  }
}
