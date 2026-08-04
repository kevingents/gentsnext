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
 * offline per definitie onbekend) en geen foto's (te groot; de kassa toont dan
 * het pakket-icoon).
 *
 * Gepagineerd (offset/limit) om onder de serverless-responsegrens te blijven.
 * Body: { page?: number, limit?: number } → { ok, page, rows, klaar, totaal }
 * Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { page?: number; limit?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const limit = Math.min(Math.max(Number(body?.limit) || 15000, 1000), 20000);
  const page = Math.max(Number(body?.page) || 0, 0);

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
    where p.status = 'active'
    order by v.id
    limit ${limit} offset ${page * limit}`);

  const [{ n } = { n: 0 }] = (await getDb().execute<{ n: number }>(sql`
    select count(*)::int n from product_variants v join products p on p.id = v.product_id where p.status = 'active'`)).rows;

  return NextResponse.json({
    ok: true,
    page,
    totaal: Number(n) || 0,
    klaar: (page + 1) * limit >= (Number(n) || 0),
    rows: rows.rows,
  });
}
