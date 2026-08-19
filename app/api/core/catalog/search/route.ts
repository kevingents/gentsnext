import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/catalog/search — SNELLE fuzzy tekstzoek over de catalogus voor het
 * GETYPTE zoeken in de kassa (tegenhanger van /catalog/lookup voor de barcode-scan).
 *
 * KALE, directe pg_trgm-query (geen searchProducts-overhead zoals locale/settings/kaart-
 * opbouw): één query die per variant matcht op titel (word_similarity + ilike), sku,
 * barcode en kleur, gerangschikt op score. Bewust GEEN in_stock/zichtbaarheids-filter:
 * aan de kassa moet je élk actief artikel kunnen vinden (ook het laatste stuk, of iets
 * dat de — soms verouderde — catalogus-voorraadvlag zou verbergen). Voorraad volgt async
 * via /api/store/article-stock. Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN.
 *
 * Body: { q, limit? } → { ok, results:[ ... article-search entry ... ] }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { q?: string; limit?: number };
  try {
    body = (await req.json()) as { q?: string; limit?: number };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const q = String(body?.q || "").trim();
  const limit = Math.min(Math.max(Number(body?.limit) || 24, 1), 50);
  if (q.length < 2) return NextResponse.json({ ok: true, results: [] });

  const qLower = q.toLowerCase();
  const like = `%${qLower}%`;
  const rowCap = Math.min(limit * 6, 120); // variant-rijen; frontend groepeert per artikel+kleur

  type Rij = {
    product_id: string;
    handle: string;
    title: string;
    barcode: string;
    sku: string;
    size: string;
    color: string;
    price_cents: number;
    variant_id: string;
    shopify_variant_id: string | null;
    srs_artikel_id: string;
    img: string | null;
  };
  const kolommen = sql`v.product_id, p.handle, p.title, v.barcode, v.sku, v.size, v.color, v.price_cents,
      v.id as variant_id, v.shopify_variant_id, v.srs_artikel_id,
      coalesce((select pi.url from product_images pi where pi.product_id = v.product_id order by pi.is_packshot desc, pi.position asc limit 1), nullif(v.image_url, '')) img`;

  /* Cijfer-zoekopdrachten zijn codes (sku, barcode, SRS-artikelnummer), nooit
     titelwoorden. Een aparte, kale code-tak voorkomt twee problemen die de
     kassa echt voelde: (1) tussentijdse aanslagen ("00", "000", …) deden een
     contains-scan die vrijwel élke barcode raakt — daarom voelde zoeken op
     bv. 00004483 juist trager; (2) het SRS-artikelnummer werd helemaal niet
     doorzocht. Artikelnummers matchen voorloopnul-tolerant (00004483 = 4483);
     nullif vangt de all-nullen-query af zodat die niet elk leeg veld matcht. */
  const isCijfers = /^\d+$/.test(qLower);
  if (isCijfers && qLower.length < 4) return NextResponse.json({ ok: true, results: [] });

  const rows = isCijfers
    ? await getDb().execute<Rij>(sql`
    select ${kolommen},
      case
        when lower(coalesce(v.sku, '')) = ${qLower} or lower(coalesce(v.barcode, '')) = ${qLower} then 1.0
        when nullif(ltrim(coalesce(v.srs_artikel_id, ''), '0'), '') = nullif(ltrim(${qLower}, '0'), '') then 0.98
        when coalesce(v.sku, '') like ${qLower + "%"} then 0.9
        when coalesce(v.barcode, '') like ${like} then 0.85
        else 0.8
      end as score
    from product_variants v
    join products p on p.id = v.product_id
    /* Alles behalve 'archived' telt mee. Aan de kassa moet je élk bestaand
       artikel kunnen vinden: 'draft' (SRS-concepten uit de nachtimport) én
       'unlisted' — daar bleek ruim de HELFT van de catalogus onder te vallen
       (1.613 producten op 19 aug, o.a. Lucas' Blumfontain uni structuur wit),
       allemaal onvindbaar op naam zolang hier op 'active' gefilterd werd.
       Deze route wordt uitsluitend door de kassa gebruikt; de site zoekt via
       searchProducts met z'n eigen zichtbaarheidsregels. */
    where p.status <> 'archived' and (
      coalesce(v.sku, '') like ${qLower + "%"}
      or nullif(ltrim(coalesce(v.srs_artikel_id, ''), '0'), '') = nullif(ltrim(${qLower}, '0'), '')
      or coalesce(v.barcode, '') = ${qLower}
      or (${qLower.length >= 6} and (coalesce(v.barcode, '') like ${like} or coalesce(v.sku, '') like ${like}))
    )
    order by score desc, p.title asc, v.size asc
    limit ${rowCap}`)
    : /* De titel-score wordt PER PRODUCT berekend, niet per variant. In de oude
         vorm stonden de titel- en variant-voorwaarden in één OR-keten, dus kon de
         planner word_similarity() pas ná de join evalueren: ~25.000 keer per
         zoekopdracht in plaats van ~1.300 (het aantal actieve producten). Met een
         `materialized` CTE gebeurt het één keer per product; de CTE heet bewust `p`
         zodat het gedeelde kolommen-fragment hierboven ongewijzigd blijft werken.
         Gemeten op productie over 7 zoektermen: 100-157 ms -> 33-47 ms, met
         identieke resultaten en dezelfde scoring. */
      await getDb().execute<Rij>(sql`
    with p as materialized (
      select id, handle, title,
        word_similarity(${qLower}, lower(title)) ws,
        (lower(title) like ${like}) tl
      from products
      /* Alles behalve 'archived' — zie de code-tak hierboven (unlisted = helft vd catalogus). */
      where status <> 'archived'
    )
    select ${kolommen},
      greatest(
        p.ws,
        case
          when lower(coalesce(v.sku, '')) = ${qLower} or lower(coalesce(v.barcode, '')) = ${qLower} then 1.0
          when lower(coalesce(v.sku, '')) like ${like} or lower(coalesce(v.barcode, '')) like ${like} then 0.95
          when p.tl then 0.9
          when lower(coalesce(v.srs_artikel_id, '')) like ${like} then 0.7
          when lower(coalesce(v.color, '')) like ${like} then 0.5
          else 0
        end
      ) as score
    from product_variants v
    join p on p.id = v.product_id
    where p.ws > 0.3
      or p.tl
      or lower(coalesce(v.sku, '')) like ${like}
      or lower(coalesce(v.barcode, '')) like ${like}
      or lower(coalesce(v.srs_artikel_id, '')) like ${like}
      or lower(coalesce(v.color, '')) like ${like}
    order by score desc, p.title asc, v.size asc
    limit ${rowCap}`);

  const results = rows.rows.map((r) => ({
    articleNumber: r.srs_artikel_id || r.sku || "",
    barcode: r.barcode || "",
    sku: r.sku || r.barcode || "",
    productId: r.product_id || "",
    articleKey: `${r.product_id || ""}||${String(r.color || "").toLowerCase()}`,
    title: r.title || "",
    color: r.color || "",
    size: r.size || "",
    price: ((Number(r.price_cents) || 0) / 100).toFixed(2),
    /* Neon-variant-id als vangnet: article-stock sleutelt zijn antwoord op deze
       waarde en slaat hits zónder id helemaal over — een Neon-native artikel
       (geen Shopify-verleden) zou anders eeuwig "Voorraad laden…" tonen. */
    variantId: r.shopify_variant_id || r.variant_id || "",
    image: r.img || "",
    images: r.img ? [r.img] : [],
    productUrl: r.handle ? `/product/${r.handle}` : "",
    /* GEEN branches/totalPieces hier — voorraad is op dit punt ONBEKEND, niet
       nul. Een lege branches-lijst las de kassa als "bekend: 0" en toonde
       seconden lang een vals rood "Niet op voorraad" tot de async voorraad-
       lader klaar was. Weglaten = de kassa toont "Voorraad laden…". */
  }));

  return NextResponse.json({ ok: true, results });
}
