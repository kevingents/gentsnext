import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminOrToken } from "@/lib/studio-token";
import { BRAND_MODELS } from "@/lib/brand-models";
import { getMediaThemes, themeForProduct } from "@/lib/media-themes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/beeld-keuzes?handle=
 *
 * Waar je uit kunt kiezen als je vanaf het productscherm een modelfoto of een
 * sfeerbeeld laat maken: de merkmodellen, de beeldthema's en de camerastijlen.
 *
 * Mét `handle` staat er ook bij welk thema de automaat zélf zou pakken. Dat is
 * het verschil tussen een dropdown en een bruikbare dropdown: je ziet wat er
 * gebeurt als je niets kiest, en wijkt daar bewust van af.
 *
 * Thema's die uitstaan komen wél mee, gemarkeerd. Een thema met de hand
 * aanwijzen mag ook als het niet in de nachtelijke rotatie zit — anders moet je
 * het eerst voor de hele catalogus aanzetten om één beeld te maken.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const handle = (new URL(req.url).searchParams.get("handle") || "").trim();

  try {
    const store = await getMediaThemes();

    let standaardThema: string | null = null;
    let hoofdgroep = "";
    if (handle) {
      const db = getDb();
      const r = (
        await db.execute<{ hg: string; title: string }>(sql`
          select coalesce(attributes->>'hoofdgroep_omschrijving','') hg, title
          from products where handle = ${handle} limit 1`)
      ).rows[0];
      if (r) {
        hoofdgroep = r.hg;
        standaardThema = themeForProduct(store, { hoofdgroep: r.hg, handle, title: r.title })?.id ?? null;
      }
    }

    return NextResponse.json({
      ok: true,
      hoofdgroep,
      /* "zelfde" en "fashn" staan als keuze tussen de modellen: het zijn geen
         gezichten maar wel antwoorden op dezelfde vraag ("wie staat erop"). */
      modellen: [
        { id: "zelfde", label: "Dezelfde man als nu", url: "", uitleg: "Houdt het gezicht van de huidige modelfoto vast. Vervalt als er een correctie openstaat." },
        { id: "fashn", label: "Laat de AI iemand kiezen", url: "", uitleg: "Geen referentiegezicht. Scheelt 3 credits, maar je krijgt elke keer iemand anders." },
        ...BRAND_MODELS.map((m) => ({ id: m.id, label: m.label, url: m.url, uitleg: "Vast GENTS-merkmodel." })),
      ],
      standaardThema,
      themas: store.themes.map((t) => ({
        id: t.id,
        label: t.label,
        scene: t.scene,
        actief: t.enabled,
        /* Zodat het scherm kan tonen dat dit thema niet bij deze hoofdgroep hoort
           — kiezen mag, maar dan weet je het. */
        pastBijGroep: hoofdgroep ? t.categories.includes(hoofdgroep) : true,
      })),
      camerastijlen: store.cameraStyles.map((s) => ({ id: s.id, label: s.label, actief: s.enabled })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
