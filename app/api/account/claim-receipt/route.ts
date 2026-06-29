import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { claimReceiptPoints } from "@/lib/loyalty-claim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/account/claim-receipt — verzilver de spaarpunten van een anonieme
 * kassabon naar het ingelogde account. Vereist een sessie (de bon-token alleen
 * verzilvert niet — je moet ingelogd zijn, zodat de punten naar een echt account
 * gaan). Idempotent.
 *
 * Body: { saleId, token } → { ok, points, alreadyClaimed, balance }
 */
export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Log eerst in om je punten te verzilveren." }, { status: 401 });

  let b: { saleId?: string; token?: string };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 }); }

  const res = await claimReceiptPoints({
    saleId: String(b?.saleId || "").trim(),
    token: String(b?.token || "").trim(),
    customerId: customer.id,
  });
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
