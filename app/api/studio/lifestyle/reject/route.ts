import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { clearLifestyleSlot } from "@/lib/lifestyle";
import { addLearning } from "@/lib/visual-learnings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30; // de notitie wordt omgezet naar een prompt-instructie

/**
 * POST /api/studio/lifestyle/reject { handle, slot:1|2|3, topic?, category, reason, url? }
 * Keurt een sfeerbeeld af: legt de reden vast in de learnings-store (de AI leert
 * ervan) én wist het slot (db-veld leeg + blob weg). topic is "beeld", "model" of
 * "kleding". Auth: admin OF STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { handle?: unknown; slot?: unknown; topic?: unknown; category?: unknown; reason?: unknown; url?: unknown };
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
    const topic = body?.topic === "kleding" || body?.topic === "model" || body?.topic === "beeld" ? body.topic : undefined;
    await addLearning({
      handle,
      slot,
      topic,
      url: body?.url ? String(body.url) : undefined,
      category: String(body?.category || "kwaliteit"),
      reason: String(body?.reason || "").trim(),
    });
    const r = await clearLifestyleSlot(handle, slot as 1 | 2 | 3);
    return NextResponse.json({ ok: r.ok });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
