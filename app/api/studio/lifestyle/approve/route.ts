import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { approveLifestyleCandidate } from "@/lib/lifestyle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/studio/lifestyle/approve { handle, slot:1|2|3, url }
 * Zet een eerder gegenereerde KANDIDAAT live op het slot (DB). Auth: admin OF token.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { handle?: unknown; slot?: unknown; url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const handle = String(body?.handle || "").trim();
  const slot = Number(body?.slot);
  const url = String(body?.url || "").trim();
  if (!handle || ![1, 2, 3].includes(slot) || !url) {
    return NextResponse.json({ ok: false, error: "Handle, slot of url ontbreekt." }, { status: 400 });
  }
  try {
    const r = await approveLifestyleCandidate(handle, slot as 1 | 2 | 3, url);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
