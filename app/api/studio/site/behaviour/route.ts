import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getDashboard } from "@/lib/analytics";
import { getNavInsights } from "@/lib/nav-insights";
import { getProductsByHandles } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/behaviour?days=30 — gedrag op de site: funnel per stap,
 * meest bekeken producten, zoekopdrachten (mét de nul-resultaten), en de
 * navigatie-inzichten (welke menu-items, filters en sorteringen gebruikt
 * worden, en welke maten klanten aanklikken terwijl ze uitverkocht zijn).
 *
 * De handles uit de gebeurtenissen worden hier al omgezet naar producttitels —
 * de portal heeft geen toegang tot de catalogus en zou anders een lijst met
 * kale slugs tonen.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const raw = Number(new URL(req.url).searchParams.get("days"));
  const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.round(raw))) : 30;

  try {
    const [dashboard, nav] = await Promise.all([getDashboard(days), getNavInsights(days)]);

    // Titels erbij zodat de portal geen slugs hoeft te tonen. Een product dat
    // intussen verwijderd is heeft geen titel meer — dan valt hij terug op de
    // handle, want de kliks zijn wél echt gebeurd en horen in het totaal.
    const cards = await getProductsByHandles(dashboard.topProducts.map((p) => p.handle));
    const titleByHandle = new Map(cards.map((c) => [c.handle, c.title]));
    const topProducts = dashboard.topProducts.map((p) => ({
      ...p,
      title: titleByHandle.get(p.handle) || p.handle,
    }));

    // getDashboard geeft de gehanteerde `days` zelf terug — niet nog eens zetten.
    return NextResponse.json({ ok: true, ...dashboard, topProducts, nav });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
