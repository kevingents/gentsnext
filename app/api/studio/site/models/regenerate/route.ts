import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { regenerateModelPhoto } from "@/lib/model-photo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // FASHN-generatie kan minuten duren

/**
 * Modellen-studio: genereer de modelfoto opnieuw MÉT de geleerde model-smaak
 * (modelLearningsBlock) + kleur-regels + native 4:5. Kost FASHN-credits.
 * Auth: admin OF token.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { handle?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const handle = String(body.handle || "").trim();
  if (!handle) return NextResponse.json({ ok: false, error: "handle vereist." }, { status: 400 });

  const res = await regenerateModelPhoto(handle);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error || "Mislukt." }, { status: 422 });
  return NextResponse.json({ ok: true, url: res.url });
}
