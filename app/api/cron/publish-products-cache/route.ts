import { NextResponse } from "next/server";
import { buildProductsCachePayload } from "@/lib/products-cache";
import { writeJsonBlobCompat } from "@/lib/blob";
import { cronSecretOk } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CACHE_PATH = "shopify-products/cache.json";

/**
 * Dagelijkse cron (zie vercel.json): bouwt de products-cache uit de eigen
 * catalogus-DB en schrijft hem naar de blob-store waar de ~44 storegents-
 * modules hem lezen. Vercel-cron stuurt automatisch
 * `Authorization: Bearer <CRON_SECRET>` mee.
 */
export async function GET(req: Request) {
  if (!cronSecretOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const payload = await buildProductsCachePayload();
  // Noodrem: nooit een (bijna) lege catalogus over de productie-cache van het
  // portaal heen publiceren — daar leunen ~44 storegents-modules op.
  if (payload.productCount < 100) {
    return NextResponse.json(
      {
        ok: false,
        error: `catalogus bevat maar ${payload.productCount} producten — publicatie geweigerd`,
      },
      { status: 412 }
    );
  }
  await writeJsonBlobCompat(CACHE_PATH, payload);
  return NextResponse.json({
    ok: true,
    path: CACHE_PATH,
    refreshedAt: payload.refreshedAt,
    productCount: payload.productCount,
    variantCount: payload.variantCount,
  });
}
