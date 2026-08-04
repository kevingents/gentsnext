import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/catalog/dump — compacte catalogus-dump voor de OFFLINE-KASSA.
 *
 * De kassa bewaart dit lokaal (IndexedDB) zodat scannen en zoeken blijven werken
 * als Vercel/Neon of het winkel-internet wegvalt. Bewust minimaal per variant:
 * codes, titel, kleur/maat, prijs en de groepeersleutel — geen voorraad (die is
 * offline per definitie onbekend) en geen foto's (te groot).
 *
 * KEYSET-paginatie (review-bevindingen): kleine pagina's (default 4000 ≈ 1,2 MB,
 * ruim onder de serverless-responsegrens van 4,5 MB die óók voor de portal-proxy
 * geldt) en een cursor op v.id i.p.v. offset — offsets verschuiven bij
 * gelijktijdige imports/status-flips en laten dan stilletjes rijen wegvallen
 * uit de kopie. klaar = minder rijen dan gevraagd (geen aparte count-query).
 *
 * Body: { cursor?: string, limit?: number } → { ok, rows, next, klaar }
 * Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { cursor?: string; limit?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const limit = Math.min(Math.max(Number(body?.limit) || 4000, 500), 5000);
  // Alleen een geldige uuid als cursor accepteren — een rommel-cursor zou anders
  // de query (uuid-vergelijking) laten klappen i.p.v. netjes vooraan beginnen.
  const rauw = String(body?.cursor || "").trim();
  const cursor = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rauw) ? rauw : "";

  const rows = await getDb().execute<{
    sku: string;
    barcode: string;
    artikelnr: string;
    title: string;
    color: string;
    size: string;
    price_cents: number;
    product_id: string;
    variant_id: string;
  }>(sql`
    select v.sku, v.barcode, coalesce(v.srs_artikel_id, '') artikelnr, p.title, v.color, v.size,
      v.price_cents, v.product_id, v.id as variant_id
    from product_variants v
    join products p on p.id = v.product_id
    where p.status = 'active' ${cursor ? sql`and v.id > ${cursor}` : sql``}
    order by v.id
    limit ${limit}`);

  const klaar = rows.rows.length < limit;
  const next = klaar ? null : rows.rows[rows.rows.length - 1]?.variant_id || null;
  return NextResponse.json({ ok: true, rows: rows.rows, next, klaar });
}
