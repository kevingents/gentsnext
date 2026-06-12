import { NextResponse } from "next/server";
import { buildProductsCachePayload } from "@/lib/products-cache";
import { writeJsonBlobCompat } from "@/lib/blob";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CACHE_PATH = "shopify-products/cache.json";

/**
 * Dagelijkse cron (zie vercel.json): bouwt de products-cache uit de eigen
 * catalogus-DB en schrijft hem naar de blob-store waar de ~44 storegents-
 * modules hem lezen. Vercel-cron stuurt automatisch
 * `Authorization: Bearer <CRON_SECRET>` mee.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return header === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const payload = await buildProductsCachePayload();
  await writeJsonBlobCompat(CACHE_PATH, payload);
  return NextResponse.json({
    ok: true,
    path: CACHE_PATH,
    refreshedAt: payload.refreshedAt,
    productCount: payload.productCount,
    variantCount: payload.variantCount,
  });
}
