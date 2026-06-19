import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { listCustomers, type CustomerListOpts } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/customers?search&page&pageSize&sort
 * Gepagineerde klantenlijst van de nieuwe site (met #orders + besteed).
 * Auth: admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const opts: CustomerListOpts = {
    search: sp.get("search") || undefined,
    sort: (sp.get("sort") as CustomerListOpts["sort"]) || undefined,
    page: Math.max(1, Number(sp.get("page")) || 1),
    pageSize: Math.min(100, Math.max(5, Number(sp.get("pageSize")) || 30)),
  };
  try {
    const result = await listCustomers(opts);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
