import { NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import { isValidSignature, SIGNATURE_HEADER_NAME } from "@sanity/webhook";

export const dynamic = "force-dynamic";

/**
 * Sanity revalidate-webhook: ververst de site direct na een contentwijziging.
 * Sanity ondertekent de body (HMAC); we verifiëren met SANITY_REVALIDATE_SECRET.
 *
 * Webhook in Sanity (API → Webhooks):
 *   URL    https://<site>/api/revalidate
 *   Trigger create/update/delete, filter: _type in ["page","landing"]
 *   Projection: {"_type": _type, "slug": slug.current}
 *   Secret  = dezelfde waarde als SANITY_REVALIDATE_SECRET in Vercel
 */
export async function POST(req: Request) {
  const secret = process.env.SANITY_REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "SANITY_REVALIDATE_SECRET niet gezet" }, { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get(SIGNATURE_HEADER_NAME) || "";
  const valid = await isValidSignature(body, signature, secret);
  if (!valid) {
    return NextResponse.json({ ok: false, error: "ongeldige handtekening" }, { status: 401 });
  }

  // Alle Sanity-content verversen; en gericht de gewijzigde pagina.
  revalidateTag("sanity");
  try {
    const payload = JSON.parse(body || "{}");
    const slug = payload?.slug;
    if (slug) revalidatePath(`/pages/${slug}`);
  } catch {
    /* projectie ontbreekt → tag-revalidate volstaat */
  }

  return NextResponse.json({ ok: true, revalidated: true });
}
