import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { validateGiftcard, redeemGiftcard, releaseGiftcard } from "@/lib/giftcards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/giftcard — cadeaubon aan de KASSA, tegen het Neon-saldo. Auth:
 * STORE_CORE_TOKEN (coreAuth). Action-based:
 *   { action:'validate', code, amountCents }        → saldo-check (valid/balance/applyCents)
 *   { action:'redeem',  code, ref, amountCents }     → idempotent afboeken op ref (= sale-id/clientRef)
 *   { action:'release', code, ref }                  → een eerder afgeboekt bedrag terug (annulering), idempotent
 *
 * redeemGiftcard is atomair (conditionele UPDATE, saldo nooit negatief) én idempotent
 * per (code, ref) via de giftcard-transacties → een dubbele/retry-POST boekt niet dubbel af.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let b: { action?: string; code?: string; ref?: string; amountCents?: number };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const action = String(b?.action || "").trim();
  const code = String(b?.code || "").trim();
  const amountCents = Math.max(0, Math.floor(Number(b?.amountCents) || 0));

  try {
    if (action === "validate") {
      const v = await validateGiftcard(code, amountCents);
      return NextResponse.json({ ok: v.valid, ...v });
    }
    if (action === "redeem") {
      const ref = String(b?.ref || "").trim();
      if (!ref) return NextResponse.json({ ok: false, error: "ref (sale-id) vereist." }, { status: 400 });
      const redeemedCents = await redeemGiftcard(code, ref, amountCents);
      return NextResponse.json({ ok: redeemedCents > 0, redeemedCents });
    }
    if (action === "release") {
      const ref = String(b?.ref || "").trim();
      if (!ref) return NextResponse.json({ ok: false, error: "ref (sale-id) vereist." }, { status: 400 });
      await releaseGiftcard(code, ref);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "Onbekende action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "fout" }, { status: 500 });
  }
}
