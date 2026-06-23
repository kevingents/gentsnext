import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { recordMovements, type RecordInput } from "@/lib/store-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/stock/movement — boek voorraad-mutaties in het core-grootboek.
 * De kassa (storegents) roept dit aan bij afrekenen (sign -1) en annuleren
 * (sign +1). Auth: STORE_CORE_TOKEN of admin/STUDIO_API_TOKEN.
 *
 * Body: { location, channel?, reason?, ref?, sign?, lines: [{ barcode|sku|articleNumber, qty, name?, color?, size? }] }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: RecordInput;
  try {
    body = (await req.json()) as RecordInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  if (!body?.location || !Array.isArray(body?.lines)) {
    return NextResponse.json({ ok: false, error: "location + lines vereist." }, { status: 400 });
  }
  try {
    const result = await recordMovements(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
