import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { setContentDoc } from "@/lib/content-store";
import { docVersion, CONFLICT_MESSAGE } from "@/lib/content-version";
import { getExperiments, schoonExperimentsDoc } from "@/lib/experiments";

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
    if (typeof body.version === "string" && body.version) {
      const huidig = docVersion((await getExperiments()).experimenten);
      if (body.version !== huidig) {
        return NextResponse.json({ ok: false, error: CONFLICT_MESSAGE, conflict: true }, { status: 409 });
      }
    }
    const doc = schoonExperimentsDoc({ experimenten: body.experimenten });
    await setContentDoc("experiments", doc);
    const { experimenten } = await getExperiments();
    return NextResponse.json({ ok: true, experimenten, version: docVersion(experimenten) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
