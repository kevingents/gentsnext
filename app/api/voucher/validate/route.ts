import { NextResponse } from "next/server";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { validateVoucher } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

/** Valideert een kortingscode tegen het subtotaal (centen). */
export async function POST(req: Request) {
  // Backstop rate-limit per IP (kortingscode-enumeratie).
  const _ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const _rl = rateLimit("vcval:" + fingerprint(_ip), 20, 60000);
  if (!_rl.ok) return NextResponse.json({ ok: false, error: "Te veel verzoeken — probeer het zo weer." }, { status: 429, headers: { "retry-after": String(_rl.retryAfterSec) } });
  try {
    const body = await req.json();
    const code = String(body?.code || "");
    const subtotalCents = Math.max(0, Number(body?.subtotalCents) || 0);
    const res = await validateVoucher(code, subtotalCents);
    return NextResponse.json(res);
  } catch {
    return NextResponse.json({ valid: false, code: "", discountCents: 0, label: "", error: "fout" }, { status: 200 });
  }
}
