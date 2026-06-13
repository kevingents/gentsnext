import { NextResponse } from "next/server";
import { validateVoucher } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

/** Valideert een kortingscode tegen het subtotaal (centen). */
export async function POST(req: Request) {
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
