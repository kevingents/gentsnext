import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { regenerateLifestyleSlot } from "@/lib/lifestyle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // FASHN product-to-model kan minuten duren

/**
 * POST /api/studio/lifestyle/regenerate { handle, slot:1|2|3 }
 * Genereert een KANDIDAAT-sfeerbeeld (mét de geleerde stijl-regels), nog NIET live —
 * pas na /approve wordt het slot bijgewerkt. Kost FASHN-credits → alleen op expliciete
 * aanvraag. Auth: admin OF STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { handle?: unknown; slot?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const handle = String(body?.handle || "").trim();
  const slot = Number(body?.slot);
  if (!handle || ![1, 2, 3].includes(slot)) {
    return NextResponse.json({ ok: false, error: "Handle of slot ontbreekt." }, { status: 400 });
  }
  const r = await regenerateLifestyleSlot(handle, slot as 1 | 2 | 3);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
