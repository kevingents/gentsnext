import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { getSessionCustomer } from "@/lib/account";
import { OP_WEBSITE_SQL } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/studio/eigen-beeld — fotografeer-werklijst voor de Shopify-exit.
 *
 * ANDERE LIJST DAN "Producten zonder foto". Die lijst komt uit de SRS-productinfo
 * en toont artikelen die in SRS nog geen foto hebben. Deze lijst gaat over iets
 * anders: producten die op de site staan en er prima uitzien, maar waarvan élke
 * foto op cdn.shopify.com staat. Gaat die shop dicht, dan staan ze op zwart — en
 * omdat has_image de zichtbaarheidsvlag is, vallen ze meteen ook uit de listings.
 *
 * "Eigen beeld" = alles wat NIET op de Shopify-CDN staat: een eigen packshot, een
 * AI-modelfoto, een sfeerbeeld of een detailfoto (die staan op Vercel Blob).
 *
 * Gesorteerd op voorraadwaarde, want dat bepaalt wat je als eerste voor de lens
 * wilt hebben. Levert per product ook het aantal stuks en de winkels erbij, zodat
 * duidelijk is wáár het artikel ligt om te fotograferen.
 *
 * Auth: gentsnext-admin-sessie OF Bearer <STUDIO_API_TOKEN> (voor de portal).
 *
 * Query:
 *   scope   'website' (default) = alleen wat nu op de site staat
 *           'alles'             = ook producten die niet zichtbaar zijn
 *   limit   max. aantal rijen (default 500, max 2000)
 */

const SHOPIFY_HOST = "cdn.shopify.com";

function tokenOk(req: Request): boolean {
  const want = (process.env.STUDIO_API_TOKEN || "").trim();
  if (!want) return false;
  const got = (req.headers.get("authorization") || req.headers.get("x-studio-token") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return !!got && got === want;
}

type Rij = {
  handle: string;
  title: string;
  hoofdgroep: string | null;
  merk: string | null;
  op_website: boolean;
  stock_qty: number | null;
  prijs_cent: number | null;
  aantal_fotos: number;
  eerste_foto: string | null;
};

export async function GET(req: Request) {
  const customer = await getSessionCustomer().catch(() => null);
  if (!customer?.isAdmin && !tokenOk(req)) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  const url = new URL(req.url);
  const alles = url.searchParams.get("scope") === "alles";
  const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get("limit") || 500)));

  try {
    const db = getDb();
    /* Eigen beeld = een niet-Shopify bron. De AI-modelfoto's/sfeerbeelden staan als
       kolom op products (model_image_url etc.), de packshots als rij in
       product_images. Een product telt als "heeft eigen beeld" zodra één van die
       bronnen gevuld is met iets dat niet op de Shopify-CDN staat. */
    const rows = await db.execute<Rij>(sql`
      with beeld as (
        select p.id,
          count(*) filter (where pi.url is not null)::int aantal_fotos,
          count(*) filter (where pi.url is not null and pi.url not like ${'%' + SHOPIFY_HOST + '%'})::int eigen_fotos,
          min(pi.url) filter (where pi.url is not null) eerste_foto
        from products p
        left join product_images pi on pi.product_id = p.id
        group by p.id
      )
      select p.handle, p.title,
        p.attributes ->> 'hoofdgroep_omschrijving' hoofdgroep,
        p.attributes ->> 'merk' merk,
        (${sql.raw(OP_WEBSITE_SQL)}) op_website,
        p.stock_qty,
        (select min(v.price_cents) from product_variants v where v.product_id = p.id) prijs_cent,
        b.aantal_fotos, b.eerste_foto
      from products p
      join beeld b on b.id = p.id
      where b.eigen_fotos = 0
        and coalesce(p.model_image_url, '') = ''
        and coalesce(p.model_image_url2, '') = ''
        and coalesce(p.lifestyle_image_url, '') = ''
        and coalesce(p.lifestyle_image_url2, '') = ''
        and coalesce(p.lifestyle_image_url3, '') = ''
        and coalesce(p.detail_image_url, '') = ''
        ${alles ? sql`` : sql`and ${sql.raw(OP_WEBSITE_SQL)}`}
      order by (coalesce(p.stock_qty, 0) *
                coalesce((select min(v.price_cents) from product_variants v where v.product_id = p.id), 0)) desc,
               coalesce(p.stock_qty, 0) desc
      limit ${limit}`);

    const items = rows.rows.map((r) => ({
      handle: r.handle,
      titel: r.title,
      hoofdgroep: r.hoofdgroep || "",
      merk: r.merk || "",
      opWebsite: Boolean(r.op_website),
      stuks: Number(r.stock_qty || 0),
      prijsCent: Number(r.prijs_cent || 0),
      voorraadwaardeCent: Number(r.stock_qty || 0) * Number(r.prijs_cent || 0),
      aantalFotos: Number(r.aantal_fotos || 0),
      // De huidige (Shopify-)foto, zodat de fotograaf ziet wát hij namaakt.
      huidigeFoto: r.eerste_foto || "",
    }));

    return NextResponse.json({
      ok: true,
      scope: alles ? "alles" : "website",
      totaal: items.length,
      totaalStuks: items.reduce((n, i) => n + i.stuks, 0),
      totaalWaardeCent: items.reduce((n, i) => n + i.voorraadwaardeCent, 0),
      items,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
