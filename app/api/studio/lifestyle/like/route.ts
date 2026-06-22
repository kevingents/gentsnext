import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { addLearning } from "@/lib/visual-learnings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/studio/lifestyle/like { handle, slot:1|2|3, url?, reason? }
 * Markeert een sfeerbeeld als TOP/geweldig → positieve learning (de AI versterkt
 * deze stijl in volgende generaties). Auth: admin OF STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { handle?: unknown; slot?: unknown; url?: unknown; reason?: unknown };
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
  try {
    await addLearning({
      handle,
      slot,
      url: body?.url ? String(body.url) : undefined,
      category: "kwaliteit",
      reason: String(body?.reason || "").trim(),
      kind: "positive",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
