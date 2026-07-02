import { NextResponse } from "next/server";
import { estimateDelivery } from "@/lib/fulfillment";
import { getLocale } from "@/lib/locale-server";

export const dynamic = "force-dynamic";

/**
 * Levertijd-schatting voor een setje SKU's (cart/PDP) — vóór de checkout.
 * Body: { items: [{ sku, qty }], country? }.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const items = Array.isArray(body?.items)
      ? body.items
          .filter((i: any) => i && typeof i.sku === "string")
          .map((i: any) => ({ sku: i.sku, qty: Math.max(1, Number(i.qty) || 1) }))
          .slice(0, 50)
      : [];
    if (!items.length) return NextResponse.json({ estimate: null });
    const locale = await getLocale();
    const estimate = await estimateDelivery(items, { country: String(body?.country || "NL"), locale });
    return NextResponse.json({ estimate });
  } catch (e) {
    return NextResponse.json({ estimate: null, error: e instanceof Error ? e.message : "fout" }, { status: 200 });
  }
}
