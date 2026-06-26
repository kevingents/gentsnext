import { NextResponse } from "next/server";
import { redeemProfileCompletionBonus } from "@/lib/account";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/account/profile-completion — verzilver de "rond je profiel af"-link:
 * het token IS de autorisatie. Werkt het profiel bij en kent éénmalig +50 punten
 * toe (idempotent). Publiek (token-gated).
 *
 * Body: { token, firstName?, lastName?, phone?, sizeProfile? } → { ok, points, alreadyClaimed }
 */
export async function POST(req: Request) {
  let b: { token?: string; firstName?: string; lastName?: string; phone?: string; sizeProfile?: Record<string, unknown> };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 }); }

  const token = String(b?.token || "").trim();
  if (!token) return NextResponse.json({ ok: false, error: "Token ontbreekt." }, { status: 400 });

  const r = await redeemProfileCompletionBonus(token, {
    firstName: String(b?.firstName || "").trim(),
    lastName: String(b?.lastName || "").trim(),
    phone: String(b?.phone || "").trim(),
    sizeProfile: b?.sizeProfile && typeof b.sizeProfile === "object" ? b.sizeProfile : undefined,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: "Deze link is niet (meer) geldig." }, { status: 400 });
  return NextResponse.json({ ok: true, points: r.points || 0, alreadyClaimed: !!r.alreadyClaimed });
}
