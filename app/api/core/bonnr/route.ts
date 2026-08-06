import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { nextBonnr, ensureAtLeast } from "@/lib/bonnr-counter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/bonnr — atomair SRS-bonnummer per filiaal (auth: STORE_CORE_TOKEN).
 *   next    { filiaal }          → { ok, bonnr }
 *   ensure  { filiaal, minimum } → { ok, value }   (teller optillen, geen uitgifte)
 *
 * Vervangt de blob-teller die op 6 aug 2026 hetzelfde nummer twee keer uitgaf
 * (stale read) waardoor SRS een verkoop van €249,90 stil negeerde.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; filiaal?: string; minimum?: number };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }

  const filiaal = String(b?.filiaal || "").trim();
  if (!filiaal) return NextResponse.json({ ok: false, error: "filiaal vereist." }, { status: 400 });

  if (String(b?.action || "next") === "ensure") {
    const value = await ensureAtLeast(filiaal, Number(b?.minimum) || 0);
    return NextResponse.json(value == null ? { ok: false, error: "Teller niet bereikbaar." } : { ok: true, value });
  }

  const bonnr = await nextBonnr(filiaal);
  return NextResponse.json(bonnr == null ? { ok: false, error: "Teller niet bereikbaar." } : { ok: true, bonnr });
}
