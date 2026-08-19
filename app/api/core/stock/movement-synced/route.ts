import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { markMovementsSrsPosted } from "@/lib/store-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/stock/movement-synced — markeer de kassa-mutaties van een
 * verkoop als 'in SRS geboekt'. storegents roept dit aan zodra een POS-verkoop
 * succesvol naar SRS is gepost; vanaf de eerstvolgende SRS-sync valt de delta uit
 * de posDelta-som (voorkomt dubbeltelling met de baseline).
 * Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN.
 *
 * Body: { ref }   (ref = sale-id, zoals meegegeven bij /api/core/stock/movement)
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { ref?: string; channel?: string };
  try {
    body = (await req.json()) as { ref?: string; channel?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const ref = String(body?.ref || "").trim();
  if (!ref) return NextResponse.json({ ok: false, error: "ref vereist." }, { status: 400 });
  // Het kanaal moet meekomen: transfers/ontvangsten boeken op 'transfer'/'inbound'
  // en kassa-correcties/inventarisatie op 'correction' — een markering op het
  // verkeerde kanaal is een stille no-op, met dubbeltelling bij de eerstvolgende
  // baseline-sync als gevolg. Default 'pos' (verkopen).
  const channel = (["pos", "correction", "inbound", "transfer"] as const).includes(body?.channel as "pos")
    ? (body!.channel as "pos" | "correction" | "inbound" | "transfer")
    : "pos";
  try {
    await markMovementsSrsPosted(ref, channel);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
