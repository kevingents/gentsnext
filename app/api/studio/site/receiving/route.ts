import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { listOpenDiscrepancies, resolveDiscrepancy, getReceivingStats } from "@/lib/inbound-discrepancies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/receiving — voor de portal (supply chain): open ontvangst-
 * afwijkingen die afgehandeld moeten worden + de meetpunten (ontvangst-nauwkeurigheid
 * per bron/winkel, code-verdeling, dock-to-stock-doorlooptijd). Auth: admin OF STUDIO_API_TOKEN.
 *
 * POST { action:"resolve", id, status, by?, note? } — een afwijking afhandelen.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  try {
    const [discrepancies, stats] = await Promise.all([listOpenDiscrepancies(undefined, 300), getReceivingStats(90)]);
    return NextResponse.json({ ok: true, discrepancies, stats });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  let b: { action?: string; id?: string; status?: string; by?: string; note?: string };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  if (b?.action !== "resolve") return NextResponse.json({ ok: false, error: "Onbekende actie." }, { status: 400 });
  try {
    const d = await resolveDiscrepancy(String(b.id || ""), String(b.status || ""), b.by, b.note);
    return NextResponse.json({ ok: !!d, discrepancy: d });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
