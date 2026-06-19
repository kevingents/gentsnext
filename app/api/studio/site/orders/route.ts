import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { listOrders, type OrderListOpts } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/orders?search&status&channel&from&to&page&pageSize
 * Gepagineerde orderlijst van de nieuwe site. Auth: admin OF STUDIO_API_TOKEN.
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
    from: d(sp.get("from")),
    to: d(sp.get("to")),
    page: Math.max(1, Number(sp.get("page")) || 1),
    pageSize: Math.min(100, Math.max(5, Number(sp.get("pageSize")) || 30)),
  };
  try {
    const result = await listOrders(opts);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
