import { NextResponse } from "next/server";
import { validateGiftcard } from "@/lib/giftcards";

export const dynamic = "force-dynamic";

/** Checkout: cadeaubon-code valideren tegen het te dekken orderbedrag. */
export async function POST(req: Request) {
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
