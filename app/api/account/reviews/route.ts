import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { setReviewStatus } from "@/lib/reviews-db";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["published", "rejected", "pending"]);

export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer?.isAdmin) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const id = String(body?.id || "").trim();
  const status = String(body?.status || "").trim();
  if (!id || !ALLOWED.has(status)) {
    return NextResponse.json({ ok: false, error: "Ongeldige invoer." }, { status: 400 });
  }
  await setReviewStatus(id, status as "published" | "rejected" | "pending");
  return NextResponse.json({ ok: true });
}
