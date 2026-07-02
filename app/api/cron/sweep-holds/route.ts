import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getSessionCustomer } from "@/lib/account";
import { sweepExpiredHolds } from "@/lib/store-reserve";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ruimt verlopen web-voorraad-holds op (anti-oversell). Een verlaten checkout
 * houdt via een korte TTL (30 min) voorraad vast; die hold valt normaal vrij bij
 * de vólgende checkout (sweepExpiredHolds draait in reserveOrderStock). In een
 * rustige periode zónder checkouts zou verlopen voorraad blijven hangen — daarom
 * draait deze cron (zie vercel.json) 'm ook periodiek.
 *
 * Vercel stuurt automatisch `Authorization: Bearer <CRON_SECRET>`; een ingelogde
 * beheerder mag 'm ook handmatig openen. De sweep zelf is atomair + best-effort;
 * we tellen vooraf de verlopen holds zodat de cron-log laat zien of er iets vastzat.
 */
function secretOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return header === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  const customer = secretOk(req) ? null : await getSessionCustomer();
  if (!secretOk(req) && !customer?.isAdmin) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const db = getDb();
    const before = await db.execute<{ n: number; q: number }>(
      sql`select count(*)::int n, coalesce(sum(qty), 0)::int q from web_stock_holds where expires_at < now()`,
    );
    const expired = before.rows[0] ?? { n: 0, q: 0 };
    await sweepExpiredHolds();
    return NextResponse.json({ ok: true, sweptHolds: expired.n, sweptQty: expired.q });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "cron-fout" }, { status: 500 });
  }
}
