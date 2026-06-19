import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { reviews } from "@/db/schema";
import { adminOrToken } from "@/lib/studio-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET  /api/studio/site/reviews?status&page — gepagineerde productreviews voor
 *   de portal-"Nieuwe site"-CMS (lijst + moderatie). Filtert optioneel op
 *   status ('pending' | 'published' | 'rejected'); zonder filter alle reviews.
 *   Recent eerst. Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 * POST /api/studio/site/reviews — modereren: { id, status }. Zet reviews.status.
 */

const PAGE_SIZE = 30;
const MODERATABLE = ["published", "rejected", "pending"] as const;

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const status = (sp.get("status") || "").trim();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const onStatus = MODERATABLE.includes(status as (typeof MODERATABLE)[number]);

  try {
    const db = getDb();
    const where = onStatus ? eq(reviews.status, status) : undefined;

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(reviews)
      .where(where);

    const rows = await db
      .select({
        id: reviews.id,
        productHandle: reviews.productHandle,
        orderNumber: reviews.orderNumber,
        customerId: reviews.customerId,
        authorName: reviews.authorName,
        email: reviews.email,
        rating: reviews.rating,
        title: reviews.title,
        body: reviews.body,
        fit: reviews.fit,
        verified: reviews.verified,
        status: reviews.status,
        source: reviews.source,
        createdAt: reviews.createdAt,
      })
      .from(reviews)
      .where(where)
      .orderBy(desc(reviews.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);

    return NextResponse.json({ ok: true, total: Number(n) || 0, page, pageSize: PAGE_SIZE, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { id?: unknown; status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const id = String(body?.id || "").trim();
  const status = String(body?.status || "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "Geen review-id." }, { status: 400 });
  if (!MODERATABLE.includes(status as (typeof MODERATABLE)[number])) {
    return NextResponse.json({ ok: false, error: "Ongeldige status." }, { status: 400 });
  }

  try {
    const db = getDb();
    const updated = await db
      .update(reviews)
      .set({ status })
      .where(eq(reviews.id, id))
      .returning({ id: reviews.id });
    if (!updated.length) return NextResponse.json({ ok: false, error: "Review niet gevonden." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
