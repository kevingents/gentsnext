import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { redeemGiftcardInStore } from "@/lib/giftcards";

export const dynamic = "force-dynamic";

/** Cadeaubon aan de kassa verzilveren — alleen voor admins. */
export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer?.isAdmin) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const result = await redeemGiftcardInStore(String(body?.code || ""), Number(body?.amountCents));
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
