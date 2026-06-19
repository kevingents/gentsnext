import { NextResponse } from "next/server";
import { adminOrToken, rangeFromQuery } from "@/lib/studio-token";
import { revenueByDay, revenueByCategory, retentionReport, funnel } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/analytics?from&to — omzet & analyse voor de portal-
 * "Nieuwe site"-CMS: omzet-per-dag (staafdiagram), omzet-per-categorie,
 * retentie-cohorten en de conversie-funnel (laatste 30 dagen).
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const range = rangeFromQuery(new URL(req.url), 30);
  try {
    const [chart, categories, retention, conversionFunnel] = await Promise.all([
      revenueByDay(range),
      revenueByCategory(range),
      retentionReport(),
      funnel(30),
    ]);
    return NextResponse.json({
      ok: true,
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      chart,
      categories,
      retention,
      funnel: conversionFunnel,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
