import { NextResponse } from "next/server";
import { searchProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/** Snel-suggesties voor instant-search in de header. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });
  try {
    const items = await searchProducts(q, 6);
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ items: [], error: e instanceof Error ? e.message : "fout" }, { status: 500 });
  }
}
