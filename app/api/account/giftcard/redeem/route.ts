import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { redeemGiftcardInStore } from "@/lib/giftcards";

export const dynamic = "force-dynamic";

/** Cadeaubon aan de kassa verzilveren — recht "operatie". */
export async function POST(req: Request) {
  if (!(await requirePermission("operatie"))) {
    return NextResponse.json({ ok: false, error: "Geen toegang: hiervoor heb je het werkgebied Operatie nodig." }, { status: 403 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const result = await redeemGiftcardInStore(String(body?.code || ""), Number(body?.amountCents));
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
