import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { reviews } from "@/db/schema";
import { getOrderForViewer } from "@/lib/orders";
import type { ProductRating } from "@/lib/reviews";

/**
 * Native productreviews (eigen engine, los van het legacy Judge.me-aggregaat
 * in lib/reviews.ts). Geverifieerde kopers (geldig order-token + product in de
 * order) publiceren direct; overige reviews komen op 'pending' voor moderatie.
 */

const FITS = new Set(["klein", "normaal", "groot"]);

export type ReviewInput = {
  handle: string;
  rating: number;
  title?: string;
  body?: string;
  authorName?: string;
  email?: string;
  fit?: string;
  orderNumber?: string | null;
  token?: string | null;
  /** Ingelogde klant — geldt óók als geverifieerde aankoop bij eigenaarschap. */
  sessionCustomerId?: string | null;
};

export async function createReview(
  input: ReviewInput
): Promise<{ ok: true; status: "published" | "pending"; verified: boolean } | { ok: false; error: string }> {
  const handle = String(input.handle || "").trim();
  const rating = Math.round(Number(input.rating));
  if (!handle) return { ok: false, error: "Onbekend product." };
  if (!(rating >= 1 && rating <= 5)) return { ok: false, error: "Geef een score van 1 tot 5 sterren." };

  const body = String(input.body || "").trim().slice(0, 4000);
  const title = String(input.title || "").trim().slice(0, 120);
  const authorName = String(input.authorName || "").trim().slice(0, 80) || "GENTS-klant";
  const email = String(input.email || "").trim().slice(0, 160);
  const fit = FITS.has(String(input.fit)) ? String(input.fit) : "";

  const db = getDb();

  // Geverifieerde aankoop: order-token moet kloppen én het product in de order zitten.
  let verified = false;
  let customerId: string | null = null;
  let orderNumber = "";
  if (input.orderNumber && (input.token || input.sessionCustomerId)) {
    const data = await getOrderForViewer(String(input.orderNumber), {
      token: input.token ?? null,
      customerId: input.sessionCustomerId ?? null,
    });
    if (data && data.lines.some((l) => l.productHandle === handle)) {
      verified = true;
      orderNumber = data.order.orderNumber;
      customerId = data.order.customerId ?? null;
      // Eén review per order+product.
      const existing = await db
        .select({ id: reviews.id })
        .from(reviews)
        .where(and(eq(reviews.orderNumber, orderNumber), eq(reviews.productHandle, handle)))
        .limit(1);
      if (existing.length) return { ok: false, error: "Je hebt dit artikel al beoordeeld. Bedankt!" };
    }
  }

  const status: "published" | "pending" = verified ? "published" : "pending";
  await db.insert(reviews).values({
    productHandle: handle,
    orderNumber,
    customerId,
    authorName,
    email,
    rating,
    title,
    body,
    fit,
    verified,
    status,
  });
  return { ok: true, status, verified };
}

export type PublicReview = {
  id: string;
  authorName: string;
  rating: number;
  title: string;
  body: string;
  fit: string;
  verified: boolean;
  createdAt: string;
};

export async function getPublishedReviews(handle: string, limit = 50): Promise<PublicReview[]> {
  if (!handle) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.productHandle, handle), eq(reviews.status, "published")))
    .orderBy(desc(reviews.verified), desc(reviews.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    authorName: r.authorName || "GENTS-klant",
    rating: r.rating,
    title: r.title,
    body: r.body,
    fit: r.fit,
    verified: r.verified,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type ReviewSummary = ProductRating & {
  /** Aantal reviews per score; index 0 = 1 ster … index 4 = 5 sterren. */
  distribution: [number, number, number, number, number];
  fit: { klein: number; normaal: number; groot: number; total: number };
};

export async function getReviewSummary(handle: string): Promise<ReviewSummary | null> {
  if (!handle) return null;
  const db = getDb();
  const rows = await db.execute<{ rating: number; fit: string; n: number }>(sql`
    select rating, fit, count(*)::int n
    from reviews
    where product_handle = ${handle} and status = 'published'
    group by rating, fit
  `);
  let count = 0;
  let sum = 0;
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  const fit = { klein: 0, normaal: 0, groot: 0, total: 0 };
  for (const r of rows.rows) {
    const n = Number(r.n);
    const rt = Number(r.rating);
    count += n;
    sum += n * rt;
    if (rt >= 1 && rt <= 5) distribution[rt - 1] += n;
    if (r.fit === "klein" || r.fit === "normaal" || r.fit === "groot") {
      fit[r.fit] += n;
      fit.total += n;
    }
  }
  if (!count) return null;
  return { value: Math.round((sum / count) * 10) / 10, count, distribution, fit };
}

/* ── Moderatie (backend) ── */

export async function listReviewsForModeration(status = "pending", limit = 200) {
  const db = getDb();
  return db.select().from(reviews).where(eq(reviews.status, status)).orderBy(desc(reviews.createdAt)).limit(limit);
}

export async function setReviewStatus(id: string, status: "published" | "rejected" | "pending") {
  const db = getDb();
  await db.update(reviews).set({ status }).where(eq(reviews.id, id));
}

export async function countPendingReviews(): Promise<number> {
  const db = getDb();
  const r = await db.execute<{ n: number }>(sql`select count(*)::int n from reviews where status = 'pending'`);
  return Number(r.rows[0]?.n || 0);
}
