import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { heatmapDetail, heatmapOverzicht } from "@/lib/heatmap";
import { GEMETEN_PAGINAS, isApparaat, REFERENTIE_BREEDTE, type Apparaat } from "@/lib/heatmap-paginas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/heatmap?dagen=30
 *   → overzicht: per gemeten pagina het aantal kliks, dode kliks, woede-kliks,
 *     paginaweergaven en het mediane scrollbereik.
 *
 * GET /api/studio/site/heatmap?pagina=/products/[handle]&apparaat=mobiel&dagen=30
 *   → detail: rastercellen voor de kleurlaag, de meest geklikte elementen, de
 *     scrollcurve en de echte URL's die de viewer kan renderen.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  const url = new URL(req.url);
  // Number(null) is 0 en dus "finite": een ontbrekende ?dagen viel eerder op een
  // andere route door de clamp heen naar 1 dag en gaf een lege grafiek. Eerst op
  // afwezig toetsen, dan pas rekenen.
  const ruw = url.searchParams.get("dagen");
  const n = Number(ruw);
  const dagen = ruw && Number.isFinite(n) ? Math.min(365, Math.max(1, Math.round(n))) : 30;

  const pagina = url.searchParams.get("pagina") || "";
  const apparaatParam = url.searchParams.get("apparaat") || "";

  try {
    if (!pagina) {
      const overzicht = await heatmapOverzicht(dagen);
      return NextResponse.json({ ok: true, ...overzicht, gemeten: GEMETEN_PAGINAS });
    }

    if (!GEMETEN_PAGINAS.some((p) => p.key === pagina)) {
      return NextResponse.json({ ok: false, error: "Onbekende pagina." }, { status: 400 });
    }
    const apparaat: Apparaat = isApparaat(apparaatParam) ? apparaatParam : "mobiel";
    const detail = await heatmapDetail({ pagina, apparaat, dagen });
    return NextResponse.json({
      ok: true,
      ...detail,
      referentieBreedte: REFERENTIE_BREEDTE[apparaat],
      gemeten: GEMETEN_PAGINAS,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
