import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import {
  getBundelDoc,
  saveBundelDoc,
  saveBundel,
  deleteBundel,
  bundelCompleet,
  normalizeBundel,
  type Bundel,
} from "@/lib/smoking-bundles";
import { getSmokingConfig } from "@/lib/smoking-pakket";
import { SMOKING_ROLES, SMOKING_ROLE_LABEL } from "@/lib/smoking-korting";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Bundel-beheer voor het portal ("Nieuwe site" → Bundels), naast Looks.
 *
 *   GET  → alle bundels + de rollen waaruit een bundel bestaat, plus per bundel
 *          of hij bruikbaar is (elke rol gevuld én een prijs). Is er nog niets
 *          opgeslagen, dan krijg je de huidige portal-config als startpunt —
 *          zo begin je niet met een leeg scherm bij het overzetten.
 *   POST { action:"save-all", doc }   → hele document opslaan
 *        { action:"save", bundel }    → één bundel toevoegen/bijwerken
 *        { action:"delete", id }      → bundel weghalen
 *
 * Auth: admin OF STUDIO_API_TOKEN — zelfde poort als de andere studio-routes.
 */

/** Portal-config omzetten naar bundel-vorm, als startpunt bij de eerste keer. */
async function uitPortalConfig(): Promise<{ doc: Awaited<ReturnType<typeof getBundelDoc>>; bron: string }> {
  const c = await getSmokingConfig();
  if (!c.enabled || !c.niveaus.length) return { doc: null, bron: "leeg" };
  return {
    doc: {
      heading: c.heading,
      intro: c.intro,
      knoptekst: c.knoptekst,
      extras: c.extras,
      bundels: c.niveaus.map((n, i) =>
        normalizeBundel(
          {
            id: n.id,
            naam: n.naam,
            subtitel: n.subtitel,
            badge: n.badge,
            prijs: n.prijs,
            rollen: n.rollen.map((r) => ({ rol: r.rol, handles: r.handles })),
            actief: true,
          },
          i
        )
      ),
    },
    bron: "portal",
  };
}

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    let doc = await getBundelDoc();
    let bron = "site";
    if (!doc) {
      const val = await uitPortalConfig();
      doc = val.doc;
      bron = val.bron;
    }
    const bundels = (doc?.bundels ?? []).map((b: Bundel) => ({ ...b, bruikbaar: bundelCompleet(b) }));
    return NextResponse.json({
      ok: true,
      /* "portal" = nog nooit hier bewerkt; de eerste opslag maakt /site de bron. */
      bron,
      doc: doc ? { ...doc, bundels } : { heading: "", intro: "", knoptekst: "", bundels: [], extras: [] },
      rollen: SMOKING_ROLES.map((rol) => ({ rol, label: SMOKING_ROLE_LABEL[rol] })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body?.action ?? "save-all");

    let doc;
    if (action === "delete") {
      const id = String(body?.id ?? "");
      if (!id) return NextResponse.json({ ok: false, error: "id vereist." }, { status: 400 });
      doc = await deleteBundel(id);
    } else if (action === "save") {
      if (!body?.bundel) return NextResponse.json({ ok: false, error: "bundel vereist." }, { status: 400 });
      doc = await saveBundel(body.bundel);
    } else {
      if (!body?.doc) return NextResponse.json({ ok: false, error: "doc vereist." }, { status: 400 });
      doc = await saveBundelDoc(body.doc);
    }

    /* Meteen terugmelden welke bundels bruikbaar zijn: een prijs vergeten of een
       rol leeg laten is de meest gemaakte fout, en dan is de bundel stil weg. */
    return NextResponse.json({
      ok: true,
      doc: { ...doc, bundels: doc.bundels.map((b) => ({ ...b, bruikbaar: bundelCompleet(b) })) },
      onbruikbaar: doc.bundels.filter((b) => !bundelCompleet(b)).map((b) => b.naam),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
