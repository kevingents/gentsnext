import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminOrToken } from "@/lib/studio-token";
import { getProductContentOverride } from "@/lib/product-content";
import { getSeoOverride } from "@/lib/seo-overrides";
import { getRecommendations } from "@/lib/catalog";
import { getSuitPieceHandles } from "@/lib/suit-pairing";
import { getReviewSummary } from "@/lib/reviews-db";
import {
  compleetheidChecksSql,
  compleetheidScoreSql,
  leesLogboek,
  veldLabel,
  PIM_CHECKS,
  PIM_VELDEN,
  PIM_LAGEN,
} from "@/lib/pim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/studio/site/product-detail?handle= — ALLES van één artikel, voor het
 * productscherm in de portal (/site/producten/<handle>).
 *
 * Waarom één endpoint en niet zes: het scherm toont één artikel en de portal
 * praat via een BFF met een token. Zes losse calls betekent zes round-trips over
 * dezelfde verbinding voor data die altijd samen getoond wordt. De zware delen
 * (statistiek, voorraad per filiaal) draaien parallel.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */

/* Wat telt als verkocht. Zelfde lijst als de bestsellers in lib/catalog.ts —
   anders vertelt dit scherm een ander verhaal dan de rest van de portal.
   'refunded' zit er bewust NIET in: dat is teruggedraaide omzet. */
const VERKOCHT = sql`o.status in ('paid','shipped','ready_pickup','delivered')`;

type ProductRij = {
  id: string;
  handle: string;
  title: string;
  description_html: string;
  vendor: string;
  product_type: string;
  status: string;
  seo_title: string;
  seo_description: string;
  srs_artikel_nummer: string;
  srs_kleur_id: string;
  handmatige_velden: unknown;
  attributes: Record<string, unknown>;
  has_image: boolean;
  in_stock: boolean;
  stock_qty: number;
  variant_group_key: string;
  is_group_primary: boolean;
  group_color_count: number;
  variant_color_label: string;
  model_image_url: string;
  model_image_alt: string;
  model_image_url2: string;
  model_image_alt2: string;
  model_video_url: string;
  detail_image_url: string;
  lifestyle_image_url: string;
  lifestyle_image_url2: string;
  lifestyle_image_url3: string;
  created_at: string;
  updated_at: string;
  source_created_at: string | null;
  published_at: string | null;
  srs_gezien_op: string | null;
};

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const handle = (new URL(req.url).searchParams.get("handle") || "").trim();
  if (!handle) return NextResponse.json({ ok: false, error: "handle vereist." }, { status: 400 });

  try {
    const db = getDb();
    const prod = (
      await db.execute<ProductRij>(sql`
        select p.id, p.handle, p.title, p.description_html, p.vendor, p.product_type, p.status,
               p.seo_title, p.seo_description, p.srs_artikel_nummer, p.srs_kleur_id,
               p.handmatige_velden, p.attributes,
               p.has_image, p.in_stock, p.stock_qty,
               p.variant_group_key, p.is_group_primary, p.group_color_count, p.variant_color_label,
               p.model_image_url, p.model_image_alt, p.model_image_url2, p.model_image_alt2,
               p.model_video_url, p.detail_image_url,
               p.lifestyle_image_url, p.lifestyle_image_url2, p.lifestyle_image_url3,
               to_char(p.created_at,'YYYY-MM-DD') created_at,
               to_char(p.updated_at,'YYYY-MM-DD') updated_at,
               to_char(p.source_created_at,'YYYY-MM-DD') source_created_at,
               to_char(p.published_at,'YYYY-MM-DD') published_at,
               to_char(p.srs_gezien_op,'YYYY-MM-DD') srs_gezien_op
        from products p where p.handle = ${handle} limit 1`)
    ).rows[0];
    if (!prod) return NextResponse.json({ ok: false, error: "Product niet gevonden." }, { status: 404 });

    const attrs = (prod.attributes || {}) as Record<string, unknown>;
    const hoofdgroep = String(attrs.hoofdgroep_omschrijving || "");
    const handmatig = new Set(
      Array.isArray(prod.handmatige_velden) ? (prod.handmatige_velden as string[]).map(String) : [],
    );

    const [
      beelden,
      varianten,
      kleuren,
      override,
      seo,
      bijpassend,
      pakDelen,
      reviews,
      gedrag,
      verkoop,
      retour,
      voorraad,
      compleetheid,
      logboek,
    ] = await Promise.all([
      db.execute<{ url: string; alt: string; position: number; source: string; is_packshot: boolean }>(sql`
        select url, alt, position, source, is_packshot
        from product_images where product_id = ${prod.id} order by position`),

      db.execute<{
        sku: string; barcode: string; supplier_ean: string; size: string; size_label: string;
        color: string; color_family: string; price_cents: number; compare_at_cents: number | null;
        stock_qty: number; srs_artikel_id: string; position: number;
      }>(sql`
        select sku, barcode, supplier_ean, size, size_label, color, color_family,
               price_cents, compare_at_cents, stock_qty, srs_artikel_id, position
        from product_variants where product_id = ${prod.id} order by position, size`),

      /* Andere kleuren van hetzelfde artikel. Leeg group_key = geen groep; dan
         niet op '' matchen, want dan komt de halve catalogus terug. */
      prod.variant_group_key
        ? db.execute<{ handle: string; title: string; kleur: string; image: string; in_stock: boolean }>(sql`
            select handle, title, variant_color_label kleur,
                   split_part(model_image_url,'?',1) image, in_stock
            from products
            where variant_group_key = ${prod.variant_group_key} and handle <> ${handle}
            order by title limit 40`)
        : Promise.resolve({ rows: [] as { handle: string; title: string; kleur: string; image: string; in_stock: boolean }[] }),

      getProductContentOverride(handle),
      getSeoOverride(`/products/${handle}`),
      getRecommendations(hoofdgroep, prod.id, 8, { attrs }).catch(() => []),
      getSuitPieceHandles(handle).catch(() => null),
      getReviewSummary(handle).catch(() => null),

      /* Gedrag: bekeken en in-winkelwagen, 30 en 90 dagen. Eén scan over de
         handle-index in plaats van vier losse tellingen. */
      db.execute<{ type: string; d30: number; d90: number }>(sql`
        select type,
               count(*) filter (where created_at > now() - interval '30 days')::int d30,
               count(*)::int d90
        from events
        where handle = ${handle} and created_at > now() - interval '90 days'
          and type in ('product_view','add_to_cart')
        group by type`),

      /* Verkoop. order_lines heeft de handle al gedenormaliseerd, dus geen join
         op varianten nodig — en dat is maar goed ook: een SKU kan van artikel
         wisselen, de vastgelegde handle op de orderregel niet. */
      db.execute<{ stuks30: number; stuks365: number; omzet365: number; orders365: number; laatste: string | null }>(sql`
        select coalesce(sum(l.quantity) filter (where o.created_at > now() - interval '30 days'),0)::int stuks30,
               coalesce(sum(l.quantity),0)::int stuks365,
               coalesce(sum(l.unit_price_cents * l.quantity),0)::int omzet365,
               count(distinct o.id)::int orders365,
               to_char(max(o.created_at),'YYYY-MM-DD') laatste
        from order_lines l join orders o on o.id = l.order_id
        where l.product_handle = ${handle} and ${VERKOCHT}
          and o.created_at > now() - interval '365 days'`),

      /* Retouren over dezelfde 365 dagen. return_lines hangt aan de SKU, dus
         via de varianten van dít artikel. */
      db.execute<{ stuks: number }>(sql`
        select coalesce(sum(rl.qty),0)::int stuks
        from return_lines rl
        join returns r on r.id = rl.return_id
        where r.status <> 'cancelled'
          and r.created_at > now() - interval '365 days'
          and rl.sku in (select sku from product_variants where product_id = ${prod.id} and sku <> '')`),

      /* Voorraad per filiaal uit de actieve SRS-generatie. Zonder de
         gen-pointer zou je een halve sync of een oude generatie tellen. */
      db.execute<{ branch_id: string; store: string; qty: number; ideaal: number; tekort: number; sku: string }>(sql`
        select s.branch_id, s.store, s.qty, s.ideaal, s.tekort, s.sku
        from srs_stock s
        where s.gen = (select active_gen from srs_stock_meta where id = 'latest')
          and s.sku in (select sku from product_variants where product_id = ${prod.id} and sku <> '')
        order by s.store, s.sku`),

      /* Compleetheid: dezelfde expressie als de lijst en het kwaliteitsoverzicht
         (lib/pim.ts). Eén definitie — anders zegt dit scherm 85 en de lijst 78. */
      db.execute<{ score: number; checks: Record<string, boolean> }>(sql`
        select ${compleetheidScoreSql()} score, ${compleetheidChecksSql()} checks
        from products p where p.id = ${prod.id}`),

      leesLogboek(handle, 50),
    ]);

    const g = Object.fromEntries(gedrag.rows.map((r) => [r.type, r]));
    const v = verkoop.rows[0] || { stuks30: 0, stuks365: 0, omzet365: 0, orders365: 0, laatste: null };
    const retourStuks = retour.rows[0]?.stuks || 0;

    /* Per filiaal optellen over de maten: voor het overzicht wil je "Groningen
       heeft er 3", niet drie regels van 1. */
    const perFiliaal = new Map<string, { branchId: string; store: string; qty: number; ideaal: number }>();
    for (const r of voorraad.rows) {
      const k = r.branch_id;
      const b = perFiliaal.get(k) || { branchId: k, store: r.store || k, qty: 0, ideaal: 0 };
      b.qty += r.qty;
      b.ideaal += r.ideaal;
      perFiliaal.set(k, b);
    }

    return NextResponse.json({
      ok: true,
      kern: {
        handle: prod.handle,
        title: prod.title,
        status: prod.status,
        vendor: prod.vendor,
        productType: prod.product_type,
        srsArtikelNummer: prod.srs_artikel_nummer,
        srsKleurId: prod.srs_kleur_id,
        variantGroupKey: prod.variant_group_key,
        isGroupPrimary: prod.is_group_primary,
        groupColorCount: prod.group_color_count,
        variantColorLabel: prod.variant_color_label,
        hasImage: prod.has_image,
        inStock: prod.in_stock,
        stockQty: prod.stock_qty,
        /* Exact de voorwaarden die de winkel zelf stelt (lib/catalog.ts) — zodat
           je niet hoeft te raden waarom een artikel niet op de site staat. */
        opWebsite: prod.status === "active" && prod.has_image && prod.in_stock && prod.is_group_primary,
        createdAt: prod.created_at,
        updatedAt: prod.updated_at,
        sourceCreatedAt: prod.source_created_at,
        publishedAt: prod.published_at,
        srsGezienOp: prod.srs_gezien_op,
      },
      teksten: {
        bron: {
          descriptionHtml: prod.description_html || "",
          seoTitle: prod.seo_title || "",
          seoDescription: prod.seo_description || "",
        },
        override: { descriptionHtml: override?.descriptionHtml || "" },
        seoOverride: { title: seo?.title || "", description: seo?.description || "" },
      },
      /* Metavelden als lijst i.p.v. los object: het scherm wil ze sorteren en
         per veld tonen of een SRS-import eraf blijft. De slot-sleutel van een
         metaveld is 'attr:<naam>' (zie lib/pim.ts); de kale naam wordt ook nog
         geaccepteerd voor als er ooit met de hand iets in de kolom gezet is. */
      metavelden: Object.entries(attrs)
        .filter(([k]) => !k.startsWith("_"))
        .map(([sleutel, waarde]) => ({
          sleutel,
          waarde: typeof waarde === "object" ? JSON.stringify(waarde) : String(waarde ?? ""),
          handmatig: handmatig.has(`attr:${sleutel}`) || handmatig.has(sleutel),
        }))
        .sort((a, b) => a.sleutel.localeCompare(b.sleutel)),

      /* Het PIM-blok: wat mag je bewerken, wat is er vastgezet, hoe compleet is
         het, en wie heeft wat gedaan. */
      pim: {
        score: Number(compleetheid.rows[0]?.score) || 0,
        checks: PIM_CHECKS.map((c) => ({
          sleutel: c.sleutel,
          label: c.label,
          gewicht: c.gewicht,
          uitleg: c.uitleg,
          ok: !!compleetheid.rows[0]?.checks?.[c.sleutel],
        })),
        velden: PIM_VELDEN.map((veld) => ({
          sleutel: veld.sleutel,
          label: veld.label,
          type: veld.type,
          opties: veld.opties ?? null,
          maxLengte: veld.maxLengte,
          uitleg: veld.uitleg,
          bulk: veld.bulk,
          waarde: String((prod as unknown as Record<string, unknown>)[veld.kolom] ?? ""),
          vergrendeld: handmatig.has(veld.sleutel),
        })),
        lagen: PIM_LAGEN.map((l) => ({ ...l })),
        handmatig: [...handmatig],
      },
      logboek: logboek.map((r) => ({ ...r, veldLabel: veldLabel(r.veld) })),
      beelden: {
        catalogus: beelden.rows.map((r) => ({
          url: r.url,
          alt: r.alt,
          position: r.position,
          /* '' = echte gesyncte foto, 'ai-packshot' = verzonnen beeld. */
          bron: r.source || "sync",
          isPackshot: r.is_packshot,
        })),
        ai: [
          { soort: "Modelfoto", url: prod.model_image_url, alt: prod.model_image_alt },
          { soort: "Modelfoto 2", url: prod.model_image_url2, alt: prod.model_image_alt2 },
          { soort: "Detailfoto", url: prod.detail_image_url, alt: "" },
          { soort: "Sfeerbeeld 1", url: prod.lifestyle_image_url, alt: "" },
          { soort: "Sfeerbeeld 2", url: prod.lifestyle_image_url2, alt: "" },
          { soort: "Sfeerbeeld 3", url: prod.lifestyle_image_url3, alt: "" },
        ].filter((x) => x.url),
        video: prod.model_video_url || "",
      },
      varianten: varianten.rows.map((r) => ({
        sku: r.sku,
        barcode: r.barcode,
        supplierEan: r.supplier_ean,
        size: r.size,
        sizeLabel: r.size_label,
        color: r.color,
        colorFamily: r.color_family,
        priceCents: r.price_cents,
        compareAtCents: r.compare_at_cents,
        stockQty: r.stock_qty,
        srsArtikelId: r.srs_artikel_id,
      })),
      voorraad: {
        perFiliaal: [...perFiliaal.values()].sort((a, b) => b.qty - a.qty),
        perMaat: voorraad.rows.map((r) => ({ sku: r.sku, store: r.store || r.branch_id, qty: r.qty })),
      },
      kleuren: kleuren.rows.map((r) => ({
        handle: r.handle,
        title: r.title,
        kleur: r.kleur,
        image: r.image,
        inStock: r.in_stock,
      })),
      bijpassend: (bijpassend || []).map((r) => ({
        handle: r.handle,
        title: r.title,
        image: r.imageUrl,
        priceCents: r.minPriceCents,
      })),
      pakDelen,
      reviews: reviews ? { aantal: reviews.count, gemiddeld: reviews.value } : null,
      statistiek: {
        bekeken30: g.product_view?.d30 ?? 0,
        bekeken90: g.product_view?.d90 ?? 0,
        inWinkelwagen30: g.add_to_cart?.d30 ?? 0,
        inWinkelwagen90: g.add_to_cart?.d90 ?? 0,
        verkocht30: v.stuks30,
        verkocht365: v.stuks365,
        omzetCents365: v.omzet365,
        orders365: v.orders365,
        laatsteVerkoop: v.laatste,
        retour365: retourStuks,
        /* Retourpercentage over dezelfde periode. Niet berekenen bij 0 verkopen:
           "0%" leest als "gaat nooit terug" terwijl er niets verkocht is. */
        retourPct: v.stuks365 > 0 ? Math.round((retourStuks / v.stuks365) * 1000) / 10 : null,
        /* Van bekeken naar winkelwagen. Zelfde voorbehoud. */
        conversiePct:
          (g.product_view?.d90 ?? 0) > 0
            ? Math.round(((g.add_to_cart?.d90 ?? 0) / (g.product_view?.d90 ?? 1)) * 1000) / 10
            : null,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
