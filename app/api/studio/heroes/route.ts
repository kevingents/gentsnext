import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminOrToken } from "@/lib/studio-token";
import {
  HERO_ASPECTS,
  HERO_ASPECTS_PRODUCT,
  HERO_SCENES,
  HERO_THEMAS,
  listHeroBeelden,
  maakHeroBeeld,
  maakHeroVanBeeld,
  maakHeroVanProduct,
  verwijderHeroBeeld,
} from "@/lib/hero-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* fal doet tientallen seconden over een beeld, FASHN kan minuten duren. */
export const maxDuration = 300;

/**
 * Hero-/bannerbeeldbank voor de portal ("Site → Instellingen → Hero" en de
 * beeldbank-tab "Hero-banners").
 *
 *   GET    → de bestaande banners (blob ai-hero/), de vaste thema's, en de
 *            video's die we hebben (voor het video-veld van de hero).
 *   POST   → maak een nieuwe banner. Drie bronnen: `sfeer` (fal.ai, alles
 *            verzonnen), `product` (FASHN, met een echt artikel erop) en
 *            `beeld` (fal.ai image-to-image op een beeld dat we al hebben, of
 *            dat beeld ongewijzigd overnemen).
 *   DELETE → gooi een banner weg (?slug=).
 *
 * Auth: gentsnext-admin OF Bearer STUDIO_API_TOKEN (de portal-BFF).
 *
 * De video's komen uit products.model_video_url — dat zijn de enige bewegende
 * beelden die we zelf hebben. fal.ai maakt hier alleen stilstaand beeld: een
 * hero-VIDEO laten genereren is een ander (duurder) model en staat bewust nog
 * niet aan.
 */

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    /* Ontbreekt het blob-token, dan is er geen bannerlijst — maar de video's en
       de thema's werken dan nog wel. Eén ontbrekende env mag de kiezer niet
       helemaal dichtgooien; de melding komt bij `blobFout` terug. */
    let beelden: Awaited<ReturnType<typeof listHeroBeelden>> = [];
    let blobFout = "";
    try {
      beelden = await listHeroBeelden();
    } catch (e) {
      blobFout = (e as Error).message;
    }

    /* Video's: alles wat als modelvideo bij een product hangt, plus de video die
       nu in de hero staat (die staat nog op de Shopify-CDN en hoort dus niet bij
       een product). Zonder deze lijst kun je in het videoveld alleen plakken. */
    let videos: { url: string; label: string }[] = [];
    try {
      const rows = await getDb().execute<{ url: string; title: string }>(sql`
        select p.model_video_url url, p.title
        from products p
        where coalesce(p.model_video_url, '') <> ''
        order by p.updated_at desc
        limit 100`);
      videos = rows.rows.map((r) => ({ url: r.url, label: r.title || "Modelvideo" }));
    } catch {
      videos = [];
    }

    return NextResponse.json({
      ok: true,
      beelden,
      blobFout,
      videos,
      themas: HERO_THEMAS.map((h) => ({
        slug: h.slug,
        label: h.label,
        aspect: h.aspect,
        /* Een thema zonder scène-tekst kan alleen de sfeer-weg, niet de
           product-weg — dan valt 'ie in de keuzelijst weg zodra je een artikel
           erbij pakt. */
        metProduct: Boolean(HERO_SCENES[h.slug]),
      })),
      aspects: HERO_ASPECTS,
      aspectsProduct: HERO_ASPECTS_PRODUCT,
      /* Zonder sleutel kan de portal wél kiezen maar niet genereren — dan de
         knop verbergen in plaats van 'm op een 500 laten lopen. De twee wegen
         hebben elk hun eigen sleutel. */
      kanGenereren: Boolean(process.env.FAL_KEY || process.env.FAL_API_KEY),
      kanProduct: Boolean(process.env.FASHN_API_KEY),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: {
    bron?: "sfeer" | "product" | "beeld";
    handle?: string;
    beeldUrl?: string;
    beeldLabel?: string;
    hergebruik?: boolean;
    thema?: string;
    prompt?: string;
    aspect?: string;
    naam?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  try {
    /* Van een beeld dat we al hebben: een eerdere banner, een sfeerbeeld of een
       modelfoto (de outfit). fal.ai herschildert de omgeving eromheen, of we
       nemen 'm ongewijzigd over. Geen FASHN: het bronbeeld is meestal zélf al
       een gegenereerde modelfoto, en die als garment-input gebruiken is
       fictie-op-fictie (zie de AI-packshot-regel in lib/lifestyle.ts). */
    if (body.bron === "beeld") {
      const beeld = await maakHeroVanBeeld(
        { url: String(body.beeldUrl || ""), label: String(body.beeldLabel || "") },
        { thema: body.thema, prompt: body.prompt, naam: body.naam, hergebruik: Boolean(body.hergebruik) },
      );
      return NextResponse.json({ ok: true, beeld });
    }

    /* Met een artikel erbij: FASHN zet ONS product op het model en bouwt de
       scène eromheen. Zonder artikel: fal.ai verzint alles, inclusief de
       kleding — prima voor pure sfeer, maar dan hangt er geen echt pak in. */
    if (body.bron === "product") {
      const handle = (body.handle || "").trim();
      if (!handle) return NextResponse.json({ ok: false, error: "Geen product gekozen." }, { status: 400 });

      const rows = await getDb().execute<{ handle: string; title: string; hg: string; img: string }>(sql`
        select p.handle, p.title, p.attributes->>'hoofdgroep_omschrijving' hg,
          (select url from product_images pi where pi.product_id=p.id order by pi.position limit 1) img
        from products p where p.handle=${handle} limit 1`);
      const r = rows.rows[0];
      if (!r) return NextResponse.json({ ok: false, error: "Product niet gevonden." }, { status: 404 });

      const beeld = await maakHeroVanProduct(
        { handle: r.handle, titel: r.title || r.handle, hoofdgroep: r.hg || "", packshot: r.img || "" },
        body,
      );
      return NextResponse.json({ ok: true, beeld });
    }

    const beeld = await maakHeroBeeld(body);
    return NextResponse.json({ ok: true, beeld });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const slug = new URL(req.url).searchParams.get("slug") || "";
  try {
    const weg = await verwijderHeroBeeld(slug);
    if (!weg) return NextResponse.json({ ok: false, error: "Banner niet gevonden." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
