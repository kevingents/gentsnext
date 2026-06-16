import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { lookupGiftcardForStaff } from "@/lib/giftcards";

export const dynamic = "force-dynamic";

/** Cadeaubon opzoeken voor de balie/kassa — alleen voor admins. */
export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer?.isAdmin) return NextResponse.json({ error: "Geen toegang." }, { status: 403 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const info = await lookupGiftcardForStaff(String(body?.code || ""));
  return NextResponse.json(info);
}
