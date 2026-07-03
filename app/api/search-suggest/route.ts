import { NextResponse } from "next/server";
import { searchProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/* CDN-cache voor suggesties: elke (gedebouncede) toetsaanslag was een verse
   serverless-hit + DB-query. Suggesties zijn niet gepersonaliseerd en hoeven niet
   real-time (voorraad loopt max 5 min achter) → s-maxage per unieke ?q= op de edge,
   met een ruim stale-while-revalidate-venster. Het 500-pad blijft bewust ongecached. */
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400" };

/** Snel-suggesties voor instant-search in de header. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  // Lowercase → "Pak" en "pak" delen één cache-entry (de zoek is toch case-insensitief).
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ items: [] }, { headers: CACHE_HEADERS });
  try {
    const items = await searchProducts(q, 6);
    return NextResponse.json({ items }, { headers: CACHE_HEADERS });
  } catch (e) {
    return NextResponse.json({ items: [], error: e instanceof Error ? e.message : "fout" }, { status: 500 });
  }
}
