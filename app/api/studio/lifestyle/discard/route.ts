import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { discardLifestyleCandidate } from "@/lib/lifestyle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/studio/lifestyle/discard { url }
 * Verwerpt een niet-goedgekeurde KANDIDAAT (verwijdert alleen de kandidaat-blob;
 * het live-beeld blijft ongemoeid). Auth: admin OF STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  try {
    const r = await discardLifestyleCandidate(String(body?.url || "").trim());
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
