import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { listOrders, betaalSignalen, type OrderListOpts } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/orders?search&status&channel&betaling&from&to&page&pageSize
 * Gepagineerde orderlijst van de nieuwe site.
 *
 * `betaling=openstaand|mislukt|betaald` filtert op wat er met het geld gebeurde
 * (zie lib/reports betaalFilter). `signalen=1` geeft er de telling van
 * openstaande/mislukte betalingen bij, voor de kop van het overzicht — apart
 * opvraagbaar zodat doorbladeren die telling niet elke keer opnieuw doet.
 *
 * Auth: admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const d = (v: string | null) => {
    if (!v) return undefined;
    const x = new Date(v);
    return Number.isNaN(x.getTime()) ? undefined : x;
  };
  const opts: OrderListOpts = {
    search: sp.get("search") || undefined,
    status: sp.get("status") || undefined,
    channel: (sp.get("channel") as OrderListOpts["channel"]) || undefined,
    betaling: sp.get("betaling") || undefined,
    from: d(sp.get("from")),
    to: d(sp.get("to")),
    page: Math.max(1, Number(sp.get("page")) || 1),
    pageSize: Math.min(100, Math.max(5, Number(sp.get("pageSize")) || 30)),
  };
  try {
    const [result, signalen] = await Promise.all([
      listOrders(opts),
      sp.get("signalen") === "1" ? betaalSignalen().catch(() => null) : Promise.resolve(null),
    ]);
    return NextResponse.json({ ok: true, ...result, signalen });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
