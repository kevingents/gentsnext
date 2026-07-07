import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { availableByBranch } from "@/lib/store-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/stock/by-branch — beschikbaar per artikel, uitgesplitst over
 * ÁLLE filialen (SRS-baseline + core-delta) in één call. De kassa-voorraadcheck
 * (maatboog) haalt hiermee eigen winkel, magazijn én andere winkels uit dezelfde
 * verse Neon-basis, i.p.v. een aparte (verouderende) per-filiaal SRS-blob-snapshot.
 * Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN.
 *
 * Body: { keys: string[] }
 * → { ok, items: { <key>: [{ branchId, store, baseline, posDelta, webReserved, safety, available }] } }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { keys?: string[] };
  try {
    body = (await req.json()) as { keys?: string[] };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const keys = Array.isArray(body?.keys) ? body.keys.map((k) => String(k)) : [];
  if (!keys.length) {
    return NextResponse.json({ ok: false, error: "keys vereist." }, { status: 400 });
  }
  try {
    const byBranch = await availableByBranch(keys);
    const items: Record<string, ReturnType<typeof toRows>> = {};
    for (const [k, list] of byBranch) items[k] = toRows(list);
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

function toRows(
  list: { branchId: string; store: string; baseline: number; posDelta: number; webReserved: number; safety: number; available: number }[],
) {
  return list.map((b) => ({
    branchId: b.branchId,
    store: b.store,
    baseline: b.baseline,
    posDelta: b.posDelta,
    webReserved: b.webReserved,
    safety: b.safety,
    available: b.available,
  }));
}
