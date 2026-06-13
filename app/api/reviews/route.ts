import { NextResponse } from "next/server";
import { createReview } from "@/lib/reviews-db";
import { getSessionCustomer } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const customer = await getSessionCustomer();
  const result = await createReview({
    handle: body?.handle,
    rating: body?.rating,
    title: body?.title,
    body: body?.body,
    authorName: body?.authorName,
    email: body?.email,
    fit: body?.fit,
    orderNumber: body?.orderNumber,
    token: body?.token,
    sessionCustomerId: customer?.id ?? null,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
