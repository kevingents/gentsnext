import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { products, reviews } from "@/db/schema";

/**
 * Judge.me-review-import → eigen reviews-engine. Haalt de reviews op via de
 * Judge.me Reviews API en zet ze om naar native 'published' reviews
 * (source='judgeme', externalId='judgeme:<id>' voor idempotente her-sync).
 * SLECHTE reviews worden NIET geïmporteerd: alleen rating >= minRating (default
 * 4). Bedoeld om enkele avonden via een cron te draaien tot de site live gaat.
 */

const API = "https://judge.me/api/v1";
const SHOP_DOMAIN = process.env.JUDGEME_SHOP_DOMAIN || "gents-production.myshopify.com";

export function judgemeConfigured(): boolean {
  return Boolean(process.env.JUDGEME_API);
}

type JudgemeReview = {
  id: number;
  title?: string;
  body?: string;
  rating: number;
  reviewer?: { name?: string; email?: string };
  product_external_id?: number | string;
  created_at?: string;
  verified?: string | boolean;
  hidden?: boolean;
  curated?: string;
};

async function fetchPage(page: number, perPage = 100): Promise<JudgemeReview[]> {
  const token = process.env.JUDGEME_API;
  if (!token) return [];
  const url = `${API}/reviews?api_token=${encodeURIComponent(token)}&shop_domain=${encodeURIComponent(
    SHOP_DOMAIN
  )}&per_page=${perPage}&page=${page}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Judge.me ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return Array.isArray(json?.reviews) ? json.reviews : [];
}

/** Numerieke Shopify-product-id → onze handle (gid://shopify/Product/123 → "123"). */
async function buildProductMap(): Promise<Map<string, string>> {
  const db = getDb();
  const rows = await db.select({ handle: products.handle, sid: products.shopifyProductId }).from(products);
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!r.sid) continue;
    const numeric = String(r.sid).replace(/\D/g, "");
    if (numeric) map.set(numeric, r.handle);
  }
  return map;
}

export type SyncResult = {
  fetched: number;
  imported: number;
  skippedLowRating: number;
  skippedNoProduct: number;
  skippedExisting: number;
  pages: number;
};

export async function syncJudgemeReviews(opts: { minRating?: number; maxPages?: number } = {}): Promise<SyncResult> {
  if (!judgemeConfigured()) throw new Error("JUDGEME_API ontbreekt.");
  const minRating = opts.minRating ?? 4;
  const maxPages = opts.maxPages ?? 100;
  const db = getDb();
  const productMap = await buildProductMap();
  const r: SyncResult = { fetched: 0, imported: 0, skippedLowRating: 0, skippedNoProduct: 0, skippedExisting: 0, pages: 0 };

  for (let page = 1; page <= maxPages; page++) {
    const batch = await fetchPage(page);
    r.pages = page;
    if (!batch.length) break;
    r.fetched += batch.length;

    const candidates: { rev: JudgemeReview; handle: string; externalId: string }[] = [];
    for (const rev of batch) {
      if (rev.hidden || rev.curated === "spam") continue;
      if (!(Number(rev.rating) >= minRating)) {
        r.skippedLowRating++;
        continue;
      }
      const handle = productMap.get(String(rev.product_external_id ?? "").replace(/\D/g, ""));
      if (!handle) {
        r.skippedNoProduct++;
        continue;
      }
      candidates.push({ rev, handle, externalId: `judgeme:${rev.id}` });
    }

    if (candidates.length) {
      const ids = candidates.map((c) => c.externalId);
      const existing = await db.select({ e: reviews.externalId }).from(reviews).where(inArray(reviews.externalId, ids));
      const seen = new Set(existing.map((x) => x.e));
      const toInsert = candidates.filter((c) => !seen.has(c.externalId));
      r.skippedExisting += candidates.length - toInsert.length;
      if (toInsert.length) {
        await db
          .insert(reviews)
          .values(
            toInsert.map(({ rev, handle, externalId }) => ({
              productHandle: handle,
              orderNumber: "",
              authorName: (rev.reviewer?.name || "GENTS-klant").slice(0, 80),
              email: (rev.reviewer?.email || "").slice(0, 160),
              rating: Math.max(1, Math.min(5, Math.round(Number(rev.rating)))),
              title: (rev.title || "").slice(0, 120),
              body: (rev.body || "").slice(0, 4000),
              fit: "",
              verified: Boolean(rev.verified && rev.verified !== "no"),
              status: "published",
              source: "judgeme",
              externalId,
              createdAt: rev.created_at ? new Date(rev.created_at) : new Date(),
            }))
          )
          .onConflictDoNothing();
        r.imported += toInsert.length;
      }
    }

    if (batch.length < 100) break; // laatste pagina
  }
  return r;
}
