import { NextResponse } from "next/server";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { validateGiftcard } from "@/lib/giftcards";

export const dynamic = "force-dynamic";

/** Checkout: cadeaubon-code valideren tegen het te dekken orderbedrag. */
export async function POST(req: Request) {
  // Backstop rate-limit per IP (cadeaubon-code-enumeratie + saldo-onthulling).
  const _ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const _rl = rateLimit("gcval:" + fingerprint(_ip), 20, 60000);
  if (!_rl.ok) return NextResponse.json({ ok: false, error: "Te veel verzoeken — probeer het zo weer." }, { status: 429, headers: { "retry-after": String(_rl.retryAfterSec) } });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ valid: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const amount = Math.max(0, Math.floor(Number(body?.amountCents) || 0));
  const result = await validateGiftcard(String(body?.code || ""), amount);
  return NextResponse.json(result);
}
