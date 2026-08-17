import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { exportOrders, type OrderListOpts } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/studio/site/orders-export?search&status&channel&betaling&from&to
 * De orderlijst als CSV, mét dezelfde filters als het overzicht (dus ook
 * "betaling mislukt"). Puntkomma-gescheiden en met BOM: Excel opent 'm dan in
 * het Nederlands zonder importwizard.
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
  };
  try {
    const csv = await exportOrders(opts);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="bestellingen.csv"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
