import { NextResponse } from "next/server";
import { adminOrToken, rangeFromQuery } from "@/lib/studio-token";
import { getKpis, revenueByDay, topProducts, statusDistribution, listOrders } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/overview?from&to — dashboard van de nieuwe site voor de
 * portal-"Nieuwe site"-CMS: KPI's, omzet-per-dag, top-producten, status-verdeling
 * en de laatste orders. Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const range = rangeFromQuery(new URL(req.url), 30);
  try {
    const [kpis, chart, top, statuses, recent] = await Promise.all([
      getKpis(range),
      revenueByDay(range),
      topProducts(range, 10),
      statusDistribution(range),
      listOrders({ page: 1, pageSize: 8 }),
    ]);
    return NextResponse.json({
      ok: true,
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      kpis,
      chart,
      top,
      statuses,
      recent: recent.rows,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
