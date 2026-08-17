import { NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { adminOrToken } from "@/lib/studio-token";
import { getDb } from "@/db";
import { compleetheidScoreSql, pimWhereSql, pimFacetten, pimCheckLabels, miniatuurSql, PIM_VELDEN } from "@/lib/pim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/studio/site/products?search&status&kwaliteit&merk&groep&sort&page&pageSize
 *
 * De productenlijst van het PIM. Per product: variant-aantal + min/max prijs
 * (centen) geaggregeerd uit product_variants, plus de compleetheidsscore uit
 * lib/pim.ts en of er velden met de hand vastgezet zijn.
 *
 * `search` matcht title/handle (ilike) of variant.sku.
 * `kwaliteit` filtert op de PIM-werklijsten (onvolledig, of één specifieke
 * check die faalt, bv. `mist:pasvorm`) — dat is de hele reden dat een PIM
 * bestaat: van een cijfer naar de artikelen die het veroorzaken.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */

/** Sorteringen die een mens hier wil. Whitelist, want dit gaat de query in. */
const SORTERINGEN: Record<string, SQL> = {
  nieuw: sql`p.created_at desc`,
  score: sql`score asc, p.stock_qty desc`,
  "score-hoog": sql`score desc, p.created_at desc`,
  titel: sql`p.title asc`,
  voorraad: sql`p.stock_qty desc`,
};

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const search = (sp.get("search") || "").trim();
  const status = (sp.get("status") || "").trim();
  const kwaliteit = (sp.get("kwaliteit") || "").trim();
  const merk = (sp.get("merk") || "").trim();
  const groep = (sp.get("groep") || "").trim();
  const subgroep = (sp.get("subgroep") || "").trim();
  const jaar = (sp.get("jaar") || "").trim();
  const seizoen = (sp.get("seizoen") || "").trim();
  const sort = sp.get("sort") || "nieuw";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(200, Math.max(5, Number(sp.get("pageSize")) || 30));

  const score = compleetheidScoreSql();
  const order = SORTERINGEN[sort] || SORTERINGEN.nieuw;

  /* Het filter staat in lib/pim.ts zodat de CSV-export exact hetzelfde selecteert
     als dit scherm. 'mist:<check>' is de werklijst achter een tegel op het
     kwaliteitsoverzicht. */
  const filters = { search, status, kwaliteit, merk, groep, subgroep, jaar, seizoen };
  let where: SQL;
  try {
    where = pimWhereSql(filters);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }

  try {
    const db = getDb();
    const [{ n }] = (
      await db.execute<{ n: string }>(sql`select count(*) n from products p where ${where}`)
    ).rows;
    const rows = await db.execute<{
      handle: string; title: string; vendor: string; product_type: string; status: string;
      in_stock: boolean; stock_qty: number; has_image: boolean; created_at: string; image: string;
      variant_count: string; min_price_cents: string | null; max_price_cents: string | null;
      score: number; handmatig: string[] | null;
      hoofdgroep: string; subgroep: string; jaar: string; seizoen: string;
    }>(sql`
      select p.handle, p.title, p.vendor, p.product_type, p.status,
             p.in_stock, p.stock_qty, p.has_image,
             coalesce(p.attributes ->> 'hoofdgroep_omschrijving', '') hoofdgroep,
             coalesce(p.attributes ->> 'subgroep', '') subgroep,
             coalesce(p.attributes ->> 'jaar', '') jaar,
             coalesce(p.attributes ->> 'seizoen', '') seizoen,
             ${miniatuurSql()} image,
             to_char(p.created_at,'YYYY-MM-DD') created_at,
             ${score} score,
             coalesce(p.handmatige_velden, '[]'::jsonb) handmatig,
             count(v.id) variant_count, min(v.price_cents) min_price_cents, max(v.price_cents) max_price_cents
      from products p
      left join product_variants v on v.product_id = p.id
      where ${where}
      /* Groeperen op de primaire sleutel volstaat: postgres weet dan dat elke
         andere products-kolom functioneel afhankelijk is. Dat scheelt hier niet
         alleen regels — de score-expressie leest een stuk of tien kolommen, en
         die één voor één in de GROUP BY herhalen is een foutje-wachtend-om-te-
         gebeuren zodra er een check bij komt. */
      group by p.id
      order by ${order}
      limit ${pageSize} offset ${(page - 1) * pageSize}`);

    /* Ná de lijst, niet ervoor: de facet-tellingen zijn vier losse aggregaties
       en die hoeven de rij-query niet op te houden. */
    const facetten = await pimFacetten(filters);

    return NextResponse.json({
      ok: true,
      total: Number(n) || 0,
      page,
      pageSize,
      sort,
      /* De filter- en bulk-keuzes reizen mee met de lijst zelf: de portal bouwt
         zijn dropdowns hieruit op, en dan hoeft een nieuwe check of een nieuw
         bewerkbaar veld niet op twee plekken bijgehouden te worden. */
      checks: pimCheckLabels(),
      facetten,
      bulkVelden: PIM_VELDEN.filter((v) => v.bulk).map(({ sleutel, label, type, opties }) => ({
        sleutel,
        label,
        type,
        opties: opties ?? null,
      })),
      rows: rows.rows.map((x) => ({
        handle: x.handle,
        title: x.title,
        vendor: x.vendor,
        productType: x.product_type,
        status: x.status,
        inStock: !!x.in_stock,
        stockQty: Number(x.stock_qty) || 0,
        variantCount: Number(x.variant_count) || 0,
        minPriceCents: x.min_price_cents == null ? 0 : Number(x.min_price_cents) || 0,
        maxPriceCents: x.max_price_cents == null ? 0 : Number(x.max_price_cents) || 0,
        hasImage: !!x.has_image,
        image: x.image || "",
        createdAt: x.created_at,
        score: Number(x.score) || 0,
        handmatig: Array.isArray(x.handmatig) ? x.handmatig.map(String) : [],
        hoofdgroep: x.hoofdgroep || "",
        subgroep: x.subgroep || "",
        jaar: x.jaar || "",
        seizoen: x.seizoen || "",
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
