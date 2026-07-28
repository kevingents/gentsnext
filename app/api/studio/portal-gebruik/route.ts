import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { getSessionCustomer } from "@/lib/account";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/studio/portal-gebruik — leest de portal-gebruiksmeting terug.
 *
 * Beantwoordt de vraag waar het om begonnen was: welke portal-pagina's worden
 * echt gebruikt, door wie, en welke al weken niet meer. Bedoeld voor het
 * opschonen rond de SRS-exit — schrappen op cijfers in plaats van op gevoel.
 *
 * Auth: gentsnext-admin-sessie OF Bearer <STUDIO_API_TOKEN> (voor de portal).
 *
 * Query:
 *   dagen  meetvenster in dagen (default 30, max 365)
 */

function tokenOk(req: Request): boolean {
  const want = (process.env.STUDIO_API_TOKEN || "").trim();
  if (!want) return false;
  const got = (req.headers.get("authorization") || req.headers.get("x-studio-token") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return !!got && got === want;
}

type PadRij = {
  pad: string;
  openingen: number;
  gebruikers: number;
  winkels: number;
  laatst: string | null;
  kantoor: number;
  winkelpersoneel: number;
};

export async function GET(req: Request) {
  const customer = await getSessionCustomer().catch(() => null);
  if (!customer?.isAdmin && !tokenOk(req)) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  const url = new URL(req.url);
  const dagen = Math.max(1, Math.min(365, Number(url.searchParams.get("dagen") || 30)));

  try {
    const db = getDb();
    const rows = await db.execute<PadRij>(sql`
      select pad,
        sum(aantal)::int openingen,
        count(distinct gebruiker_id) filter (where gebruiker_id <> '')::int gebruikers,
        count(distinct winkel) filter (where winkel <> '')::int winkels,
        max(laatst_op)::text laatst,
        sum(aantal) filter (where soort = 'office')::int kantoor,
        sum(aantal) filter (where soort = 'personnel')::int winkelpersoneel
      from portal_usage
      where dag >= ((now() at time zone 'utc')::date - ${dagen}::int)
      group by pad
      order by openingen desc, pad`);

    const [meta] = (
      await db.execute<{ eerste: string | null; totaal: number }>(sql`
        select min(dag)::text eerste, coalesce(sum(aantal), 0)::int totaal from portal_usage`)
    ).rows;

    return NextResponse.json({
      ok: true,
      venster: dagen,
      // Vanaf wanneer meten we? Zolang dit korter is dan het venster is "0 openingen"
      // geen bewijs van ongebruikt — dat moet de portal er expliciet bij zeggen.
      metenSinds: meta?.eerste || null,
      totaalOoit: Number(meta?.totaal || 0),
      paden: rows.rows.map((r) => ({
        pad: r.pad,
        openingen: Number(r.openingen || 0),
        gebruikers: Number(r.gebruikers || 0),
        winkels: Number(r.winkels || 0),
        laatst: r.laatst,
        kantoor: Number(r.kantoor || 0),
        winkelpersoneel: Number(r.winkelpersoneel || 0),
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
