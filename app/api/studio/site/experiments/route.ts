import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { setContentDoc } from "@/lib/content-store";
import { docVersion, CONFLICT_MESSAGE } from "@/lib/content-version";
import { getExperiments, schoonExperimentsDoc, type ExperimentsDoc } from "@/lib/experiments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A/B-experimenten voor de portal.
 *   GET  → { ok, experimenten, version }
 *   POST { experimenten, version } → opgeslagen (gesaneerd) + teruggegeven
 *
 * Zelfde botsingsafspraak als de andere content-documenten (409 bij een
 * verlopen stempel; zonder stempel gewoon opslaan).
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const { experimenten } = await getExperiments();
    return NextResponse.json({ ok: true, experimenten, version: docVersion(experimenten) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { experimenten?: unknown; version?: unknown };
  try {
    body = (await req.json()) as { experimenten?: unknown; version?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  if (!Array.isArray(body.experimenten)) {
    return NextResponse.json({ ok: false, error: "Ongeldige lijst." }, { status: 400 });
  }
  try {
    const bestaand = await getExperiments();
    if (typeof body.version === "string" && body.version) {
      if (body.version !== docVersion(bestaand.experimenten)) {
        return NextResponse.json({ ok: false, error: CONFLICT_MESSAGE, conflict: true }, { status: 409 });
      }
    }
    const doc = schoonExperimentsDoc({ experimenten: body.experimenten }) as ExperimentsDoc;

    // Meetvenster: de SERVER stempelt bij een statuswissel; wat de client aan
    // datums stuurt wordt overschreven. Zonder venster tellen exposures van
    // een vorige run mee en is de uitslag van een herstart vervuild.
    const oud = new Map(bestaand.experimenten.map((e) => [e.id, e]));
    for (const e of doc.experimenten) {
      const vorige = oud.get(e.id);
      if (e.status === "actief") {
        // Al actief = venster loopt door; (her)start = nieuw venster.
        e.gestartOp = vorige?.status === "actief" && vorige.gestartOp ? vorige.gestartOp : new Date().toISOString();
        e.gestoptOp = undefined;
      } else if (e.status === "gestopt") {
        e.gestartOp = vorige?.gestartOp;
        e.gestoptOp = vorige?.status === "gestopt" && vorige.gestoptOp ? vorige.gestoptOp : new Date().toISOString();
      } else {
        // Concept: schone lei — de volgende start opent een vers venster.
        e.gestartOp = undefined;
        e.gestoptOp = undefined;
      }
    }

    await setContentDoc("experiments", doc);
    const { experimenten } = await getExperiments();
    return NextResponse.json({ ok: true, experimenten, version: docVersion(experimenten) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
