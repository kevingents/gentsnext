import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { availableBreakdown } from "@/lib/store-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/stock/available — beschikbaar per artikel in één locatie
 * (SRS-baseline + core-delta). De kassa checkt hiermee vóór afrekenen of het
 * laatste stuk er nog is. Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN.
 *
 * Body: { location, keys: string[] }  → { ok, available: { <key>: aantal } }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { location?: string; keys?: string[] };
  try {
    body = (await req.json()) as { location?: string; keys?: string[] };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const location = String(body?.location || "").trim();
  const keys = Array.isArray(body?.keys) ? body.keys.map((k) => String(k)) : [];
  if (!location || !keys.length) {
    return NextResponse.json({ ok: false, error: "location + keys vereist." }, { status: 400 });
  }
  try {
    // Breakdown (kassa-weergave) + platte 'available' (gate/back-compat) uit één bron.
    const bd = await availableBreakdown(location, keys);
    const available: Record<string, number> = {};
    const breakdown: Record<string, { baseline: number; posDelta: number; webReserved: number; safety: number; available: number }> = {};
    for (const [k, v] of bd) {
      available[k] = v.available;
      breakdown[k] = v;
    }
    return NextResponse.json({ ok: true, available, breakdown });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
