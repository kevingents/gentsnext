import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getDriftHistory } from "@/lib/stock-reconcile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Portal-"Nieuwe site" → voorraad-reservering drift-monitor (Fase 0). Geeft de
 * rollende historie van de reconcile-cron: hoe vaak/hoeveel de anti-oversell-teller
 * wegliep van de werkelijke holds. Dit is de nulmeting vóór we de kassa door dezelfde
 * gate laten lopen (Fase 1). Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const points = await getDriftHistory();
  const laatste = points[points.length - 1] || null;
  // Samenvatting over de historie: hoeveel runs drift zagen + de piek.
  const runsMetDrift = points.filter((p) => p.driftedRows > 0).length;
  const piekDrift = points.reduce((m, p) => Math.max(m, p.totalDriftAbs), 0);
  return NextResponse.json({
    ok: true,
    laatste,
    runs: points.length,
    runsMetDrift,
    piekDrift,
    points,
  });
}
