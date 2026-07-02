import { NextResponse } from "next/server";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { createReview } from "@/lib/reviews-db";
import { getSessionCustomer } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Backstop rate-limit per IP (spamt de moderatiewachtrij).
  const _ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const _rl = rateLimit("review:" + fingerprint(_ip), 6, 60000);
  if (!_rl.ok) return NextResponse.json({ ok: false, error: "Te veel verzoeken — probeer het zo weer." }, { status: 429, headers: { "retry-after": String(_rl.retryAfterSec) } });
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
