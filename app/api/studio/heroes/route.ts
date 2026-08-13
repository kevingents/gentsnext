import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminOrToken } from "@/lib/studio-token";
import { HERO_ASPECTS, HERO_THEMAS, listHeroBeelden, maakHeroBeeld, verwijderHeroBeeld } from "@/lib/hero-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* fal doet er voor een 21:9-beeld op flux-pro-ultra tientallen seconden over. */
export const maxDuration = 120;

/**
 * Hero-/bannerbeeldbank voor de portal ("Site → Instellingen → Hero" en de
 * beeldbank-tab "Hero-banners").
 *
 *   GET    → de bestaande banners (blob ai-hero/), de vaste thema's, en de
 *            video's die we hebben (voor het video-veld van de hero).
 *   POST   → maak een nieuwe banner met fal.ai (thema of vrije omschrijving).
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
      themas: HERO_THEMAS.map((h) => ({ slug: h.slug, label: h.label, aspect: h.aspect })),
      aspects: HERO_ASPECTS,
      /* Zonder FAL_KEY kan de portal wél kiezen maar niet genereren — dan de
         knop verbergen in plaats van 'm op een 500 laten lopen. */
      kanGenereren: Boolean(process.env.FAL_KEY || process.env.FAL_API_KEY),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { thema?: string; prompt?: string; aspect?: string; naam?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  try {
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
