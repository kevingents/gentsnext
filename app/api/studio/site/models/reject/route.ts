import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { addModelLearning } from "@/lib/model-learnings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Modellen-studio: een model goed-/afkeuren met reden → de AI leert de model-smaak
 * (geen FASHN-credits; gratis). kind:"negative" = afkeuren (vermijden),
 * "positive" = top (zo houden). Auth: admin OF token.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { handle?: unknown; url?: unknown; category?: unknown; reason?: unknown; kind?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  try {
    const store = await addModelLearning({
      handle: body.handle ? String(body.handle) : undefined,
      url: body.url ? String(body.url) : undefined,
      category: String(body.category || "kwaliteit"),
      reason: String(body.reason || ""),
      kind: body.kind === "positive" ? "positive" : "negative",
    });
    return NextResponse.json({ ok: true, count: store.learnings.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
