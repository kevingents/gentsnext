import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { lookupGiftcardForStaff } from "@/lib/giftcards";

export const dynamic = "force-dynamic";

/** Cadeaubon opzoeken voor de balie/kassa — recht "operatie". */
export async function POST(req: Request) {
  if (!(await requirePermission("operatie"))) {
    return NextResponse.json({ error: "Geen toegang: hiervoor heb je het werkgebied Operatie nodig." }, { status: 403 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const info = await lookupGiftcardForStaff(String(body?.code || ""));
  return NextResponse.json(info);
}
