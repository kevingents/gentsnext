import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { portalUsage } from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { coreAuth } from "@/lib/store-core-token";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * POST /api/core/portal-usage — registreert dat iemand een portal-pagina opende.
 *
 * De portal heeft 196 pagina's en tot vandaag géén enkele meting; "dit gebruiken
 * we niet" was daardoor altijd een gevoel. Bij het opschonen rond de SRS-exit is
 * dat te riskant — één verkeerd weggegooid scherm is een afdeling die vastloopt.
 *
 * Geaggregeerd per gebruiker per pagina per dag (upsert op de teller), niet per
 * klik. Dat houdt de tabel klein en beantwoordt precies de vraag die telt:
 * "wordt dit nog gebruikt, en door wie".
 *
 * De IDENTITEIT komt van de portal-BFF, die 'm uit de sessiecookie haalt — nooit
 * van de browser. Deze route vertrouwt daarop via het gedeelde STORE_CORE_TOKEN.
 *
 * Body: { pad, gebruikerId?, gebruikerNaam?, soort?, winkel? }
 */

/** Alleen het pad, zonder query/hash, en afgekapt. Query-parameters kunnen
 *  klantgegevens bevatten (?email=, ?order=) en horen hier niet in. */
function schoonPad(v: unknown): string {
  const s = String(v || "").trim();
  if (!s.startsWith("/")) return "";
  return s.split("?")[0].split("#")[0].slice(0, 200);
}

export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }

  const pad = schoonPad(body.pad);
  if (!pad) return NextResponse.json({ ok: false, error: "pad vereist." }, { status: 400 });

  const gebruikerId = String(body.gebruikerId || "").trim().slice(0, 80);
  const gebruikerNaam = String(body.gebruikerNaam || "").trim().slice(0, 120);
  const soort = String(body.soort || "").trim().slice(0, 20);
  const winkel = String(body.winkel || "").trim().slice(0, 80);

  try {
    const db = getDb();
    /* Upsert op (dag, pad, gebruiker): de eerste opening van vandaag maakt de rij,
       elke volgende hoogt de teller op. De naam updaten we mee — die kan wijzigen. */
    await db
      .insert(portalUsage)
      .values({
        dag: sql`(now() at time zone 'utc')::date` as unknown as string,
        pad,
        gebruikerId,
        gebruikerNaam,
        soort,
        winkel,
        aantal: 1,
      })
      .onConflictDoUpdate({
        target: [portalUsage.dag, portalUsage.pad, portalUsage.gebruikerId],
        set: {
          aantal: sql`${portalUsage.aantal} + 1`,
          laatstOp: sql`now()`,
          gebruikerNaam: sql`excluded.gebruiker_naam`,
          winkel: sql`excluded.winkel`,
        },
      });
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Meten mag nooit een pagina stukmaken: fout terugmelden, niet laten crashen.
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/**
 * GET /api/core/portal-usage — leest de meting terug, voor het toezicht op
 * (externe) accounts in de portal ("wat doen ze in de tool").
 *
 * Twee vormen:
 *   ?gebruikerIds=a,b,c[&dagen=30] — samenvatting per gebruiker (totaal aantal
 *     opens, aantal verschillende pagina's, laatst actief) — voor het lijstje.
 *   ?gebruikerId=a[&dagen=30]      — detail: rijen per dag per pagina — voor de
 *     uitklap van één gebruiker.
 *
 * dagen is 1..90 (default 30). Zelfde auth als de schrijfkant (coreAuth).
 */
export async function GET(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 401 });
  }

  const url = new URL(req.url);
  const dagen = Math.min(Math.max(parseInt(url.searchParams.get("dagen") || "30", 10) || 30, 1), 90);
  /* ::int is verplicht: neon-http bindt de parameter als tekst en Postgres
     kent geen `date - text` — zonder cast faalt elke GET. */
  const vanaf = sql`(now() at time zone 'utc')::date - ${dagen}::int`;

  try {
    const db = getDb();

    const idsRaw = String(url.searchParams.get("gebruikerIds") || "").trim();
    if (idsRaw) {
      const ids = [...new Set(idsRaw.split(",").map((s) => s.trim().slice(0, 80)).filter(Boolean))].slice(0, 200);
      if (!ids.length) return NextResponse.json({ ok: true, rows: [] });
      const rows = await db
        .select({
          gebruikerId: portalUsage.gebruikerId,
          totaal: sql<number>`sum(${portalUsage.aantal})::int`,
          paginas: sql<number>`count(distinct ${portalUsage.pad})::int`,
          laatstOp: sql<string>`max(${portalUsage.laatstOp})`,
        })
        .from(portalUsage)
        .where(and(inArray(portalUsage.gebruikerId, ids), sql`${portalUsage.dag} >= ${vanaf}`))
        .groupBy(portalUsage.gebruikerId);
      return NextResponse.json({ ok: true, rows });
    }

    const gebruikerId = String(url.searchParams.get("gebruikerId") || "").trim().slice(0, 80);
    if (!gebruikerId) {
      return NextResponse.json({ ok: false, error: "gebruikerId of gebruikerIds vereist." }, { status: 400 });
    }
    const rows = await db
      .select({
        dag: portalUsage.dag,
        pad: portalUsage.pad,
        aantal: portalUsage.aantal,
        laatstOp: portalUsage.laatstOp,
      })
      .from(portalUsage)
      .where(and(eq(portalUsage.gebruikerId, gebruikerId), sql`${portalUsage.dag} >= ${vanaf}`))
      .orderBy(desc(portalUsage.dag), desc(portalUsage.laatstOp))
      .limit(1000);
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
