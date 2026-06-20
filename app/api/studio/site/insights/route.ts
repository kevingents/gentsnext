import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getInsights } from "@/lib/ai-insights";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * AI-klantinzichten (portal). Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 * GET                    → live stats + gecachet AI-narratief
 * POST { regenerate:true }→ narratief opnieuw genereren (kost AI-credits)
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const result = await getInsights(new Date(), { regenerate: false });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const result = await getInsights(new Date(), { regenerate: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
