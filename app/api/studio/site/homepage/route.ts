import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { setContentDoc } from "@/lib/content-store";
import { docVersion, CONFLICT_MESSAGE } from "@/lib/content-version";
import { getHomeLayout, schoonHomeLayout, isHomepageDocKey, DEFAULT_HOME } from "@/lib/homepage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Indeling van de homepage voor de portal: welke blokken, in welke volgorde,
 * aan of uit, met hun teksten en beelden.
 *
 *   GET  → { ok, secties, version, standaard }
 *   POST { secties, version } → opgeslagen (gesaneerd) + teruggegeven
 *
 * `standaard` is de indeling zoals hij in code staat — de portal gebruikt 'm
 * voor een "terug naar standaard"-knop, zodat je een verbouwde homepage kunt
 * terugzetten zonder dat iemand in de database hoeft.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
/**
 * Optioneel ?doc= / body.doc: het variant-document van een A/B-experiment
 * ("homepage:exp:<id>:<variant>"). Alleen dat patroon — de sleutel komt via de
 * portal binnen en mag nooit een willekeurig ander content-document raken.
 */
function docKeyVan(v: unknown): string | null {
  const key = String(v ?? "homepage").trim() || "homepage";
  return isHomepageDocKey(key) ? key : null;
}

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const doc = docKeyVan(new URL(req.url).searchParams.get("doc"));
  if (!doc) return NextResponse.json({ ok: false, error: "Ongeldig document." }, { status: 400 });
  try {
    const { secties } = await getHomeLayout(doc);
    return NextResponse.json({
      ok: true,
      doc,
      secties,
      version: docVersion(secties),
      standaard: DEFAULT_HOME.secties,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { secties?: unknown; version?: unknown; doc?: unknown };
  try {
    body = (await req.json()) as { secties?: unknown; version?: unknown; doc?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  if (!Array.isArray(body.secties)) {
    return NextResponse.json({ ok: false, error: "Ongeldige lijst." }, { status: 400 });
  }
  const doc = docKeyVan(body.doc);
  if (!doc) return NextResponse.json({ ok: false, error: "Ongeldig document." }, { status: 400 });

  try {
    // Botsingscontrole, zelfde afspraak als pagina's/menu/gelegenheden: stuurt de
    // client de stempel mee die hij bij het openen kreeg, dan moet die nog
    // kloppen. Ontbreekt hij, dan slaan we gewoon op — een oudere client mag
    // tijdens een uitrol niet stil blokkeren.
    if (typeof body.version === "string" && body.version) {
      const huidig = docVersion((await getHomeLayout(doc)).secties);
      if (body.version !== huidig) {
        return NextResponse.json({ ok: false, error: CONFLICT_MESSAGE, conflict: true }, { status: 409 });
      }
    }

    const layout = schoonHomeLayout({ secties: body.secties });
    await setContentDoc(doc, layout);
    // Verse stempel uit de leeslaag, niet uit wat we net instuurden.
    const { secties } = await getHomeLayout(doc);
    return NextResponse.json({ ok: true, doc, secties, version: docVersion(secties) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
