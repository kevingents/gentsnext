import { NextResponse } from "next/server";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { validateGiftcard } from "@/lib/giftcards";
import { validateVoucher } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

/**
 * Eén-veld-inwisselen: de klant vult bij het afrekenen één code in en wij
 * bepalen of het een cadeaubon of een kortingscode is. Eerst cadeaubon
 * (specifiek GIFT-formaat), dan voucher.
 */
export async function POST(req: Request) {
  // Backstop rate-limit per IP (code-enumeratie (voucher/cadeaubon)).
  const _ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const _rl = rateLimit("redeem:" + fingerprint(_ip), 20, 60000);
  if (!_rl.ok) return NextResponse.json({ ok: false, error: "Te veel verzoeken — probeer het zo weer." }, { status: 429, headers: { "retry-after": String(_rl.retryAfterSec) } });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ type: "none", error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const code = String(body?.code || "").trim();
  if (!code) return NextResponse.json({ type: "none", error: "Vul een code in." }, { status: 400 });
  const subtotalCents = Math.max(0, Math.floor(Number(body?.subtotalCents) || 0));
  const amountCents = Math.max(0, Math.floor(Number(body?.amountCents) || 0));

  const g = await validateGiftcard(code, amountCents);
  if (g.valid) {
    return NextResponse.json({ type: "giftcard", code: g.code, balanceCents: g.balanceCents });
  }

  const v = await validateVoucher(code, subtotalCents);
  if (v.valid) {
    return NextResponse.json({ type: "voucher", code: v.code, discountCents: v.discountCents, label: v.label });
  }

  // Geen van beide geldig — geef de meest relevante foutmelding terug.
  const looksGiftcard = /^gift[-\s]/i.test(code);
  const error = looksGiftcard
    ? g.error || "Onbekende of niet-actieve cadeaubon."
    : v.error || "Onbekende kortingscode of cadeaubon.";
  return NextResponse.json({ type: "none", error });
}
