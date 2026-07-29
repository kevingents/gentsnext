import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { getSessionCustomer } from "@/lib/account";
import { OP_WEBSITE_SQL } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/studio/dubbele-skus — varianten die dezelfde sku delen.
 *
 * De sku is de sleutel waarop srs_stock matcht: één sku hoort bij precies één
 * fysieke variant. Delen twee varianten er één, dan is niet te zeggen welke van
 * de twee die voorraad heeft — en boekt de kassa mogelijk op de verkeerde.
 * Nagemeten 28 juli: 22.848 varianten met een sku, 22.744 unieke waarden, dus
 * 104 duplicaten. Daarom staat er (nog) geen unieke index op sku.
 *
 * Deze lijst is bedoeld om ze in SRS op te schonen. Per sku geven we alle
 * betrokken varianten terug met product, maat, kleur en of ze op de site staan,
 * zodat te zien is welke de echte is.
 *
 * Auth: gentsnext-admin-sessie OF Bearer <STUDIO_API_TOKEN> (voor de portal).
 */

function tokenOk(req: Request): boolean {
  const want = (process.env.STUDIO_API_TOKEN || "").trim();
  if (!want) return false;
  const got = (req.headers.get("authorization") || req.headers.get("x-studio-token") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return !!got && got === want;
}

type Rij = {
  sku: string;
  aantal: number;
  handle: string;
  title: string;
  size: string;
  color: string;
  barcode: string;
  op_website: boolean;
  hoofdgroep: string | null;
};

export async function GET(req: Request) {
  const customer = await getSessionCustomer().catch(() => null);
  if (!customer?.isAdmin && !tokenOk(req)) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  try {
    const db = getDb();
    const rows = await db.execute<Rij>(sql`
      with dubbel as (
        select sku, count(*)::int aantal
        from product_variants
        where coalesce(sku, '') <> ''
        group by sku
        having count(*) > 1
      )
      select d.sku, d.aantal, p.handle, p.title, v.size, v.color, v.barcode,
        (${sql.raw(OP_WEBSITE_SQL)}) op_website,
        p.attributes ->> 'hoofdgroep_omschrijving' hoofdgroep
      from dubbel d
      join product_variants v on v.sku = d.sku
      join products p on p.id = v.product_id
      order by d.aantal desc, d.sku, p.title`);

    /* Groeperen per sku: één regel per dubbele sku met de betrokken varianten
       eronder — zo is in één blik te zien of het om twee kleuren, twee maten of
       een echte dubbeling gaat. */
    const perSku = new Map<string, { sku: string; aantal: number; varianten: unknown[] }>();
    for (const r of rows.rows) {
      let g = perSku.get(r.sku);
      if (!g) {
        g = { sku: r.sku, aantal: Number(r.aantal || 0), varianten: [] };
        perSku.set(r.sku, g);
      }
      g.varianten.push({
        handle: r.handle,
        titel: r.title,
        maat: r.size || "",
        kleur: r.color || "",
        barcode: r.barcode || "",
        hoofdgroep: r.hoofdgroep || "",
        opWebsite: Boolean(r.op_website),
      });
    }

    const items = [...perSku.values()];
    return NextResponse.json({
      ok: true,
      totaalSkus: items.length,
      totaalVarianten: rows.rows.length,
      // Hoeveel hiervan raken een product dat NU op de site staat — die zijn urgent.
      opWebsite: items.filter((i) =>
        (i.varianten as { opWebsite: boolean }[]).some((v) => v.opWebsite)
      ).length,
      items,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
