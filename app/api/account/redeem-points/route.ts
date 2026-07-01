import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { redeemPointsForVoucher } from "@/lib/loyalty-claim";

export const dynamic = "force-dynamic";

/**
 * Wissel spaarpunten in voor een GENTS-tegoedbon (Neon-native voucher, geen SRS).
 * Sessie-gated: alleen de ingelogde klant kan z'n eigen punten inwisselen.
 */
export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer) {
    return NextResponse.json({ ok: false, error: "Log in om punten in te wisselen." }, { status: 401 });
  }
  let body: { points?: number };
  try {
    body = (await req.json()) as { points?: number };
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const result = await redeemPointsForVoucher(customer.id, Number(body?.points));
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
