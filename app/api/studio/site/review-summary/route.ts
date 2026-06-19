import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import {
  getCachedReviewAiSummary,
  buildAndCacheReviewAiSummary,
  buildAllReviewSummaries,
} from "@/lib/review-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // batch-generatie kan minuten duren

/**
 * AI-reviewsamenvattingen (portal-gestuurd). Auth: gentsnext-admin OF token.
 * GET  ?handle=…           → cache lezen
 * POST { handle, force? }  → één product (her)genereren
 * POST { all:true, force? }→ batch: alle producten met genoeg reviews
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const handle = new URL(req.url).searchParams.get("handle") || "";
  const summary = await getCachedReviewAiSummary(handle);
  return NextResponse.json({ ok: true, summary });
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { handle?: unknown; all?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const force = Boolean(body.force);
  try {
    if (body.all) {
      const res = await buildAllReviewSummaries({ force, max: 200 });
      return NextResponse.json({ ok: true, ...res });
    }
    const handle = String(body.handle || "").trim();
    if (!handle) return NextResponse.json({ ok: false, error: "handle of all vereist." }, { status: 400 });
    const summary = await buildAndCacheReviewAiSummary(handle, { force });
    if (!summary) {
      return NextResponse.json({ ok: false, error: "Onvoldoende reviews of AI niet beschikbaar (ANTHROPIC_API_KEY)." }, { status: 422 });
    }
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
