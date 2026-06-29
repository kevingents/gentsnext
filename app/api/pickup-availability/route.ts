import { NextResponse } from "next/server";
import { getStores } from "@/lib/stores";
import { availableInStore } from "@/lib/store-core";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * Voorraad per winkel voor de afhaal-keuze in de checkout. Geeft per winkel terug
 * of álle artikelen in de winkelwagen daar op voorraad liggen, zodat de klant een
 * winkel kan kiezen waar alles klaar ligt. Let op: dit is winkelvoorraad — een
 * artikel dat voor bezorgen (web) uitverkocht is, kan in een winkel wél liggen.
 *
 * POST { items: [{ sku, qty }] } → { stores: [{ name, city, allOk, okCount, total, missingSkus }] }
 */
type StoreAvail = { name: string; city: string; allOk: boolean; okCount: number; total: number; missingSkus: string[] };

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ stores: [] });
  }
  const rawItems = (body as { items?: unknown })?.items;
  const items = Array.isArray(rawItems)
    ? rawItems
        .map((i) => i as { sku?: unknown; qty?: unknown })
        .filter((i) => i?.sku)
        .map((i) => ({ sku: String(i.sku).trim(), qty: Math.max(1, Number(i.qty) || 1) }))
    : [];

  const stores = getStores();
  if (!items.length) {
    return NextResponse.json({
      stores: stores.map((s) => ({ name: s.title, city: s.city, allOk: true, okCount: 0, total: 0, missingSkus: [] })),
    });
  }
  const skus = [...new Set(items.map((i) => i.sku))];

  async function forStore(s: { title: string; city: string }): Promise<StoreAvail> {
    try {
      const avail = await availableInStore(s.title, skus);
      // Case-ongevoelige lookup (norm() trimt alleen, behoudt case).
      const lc = new Map<string, number>();
      for (const [k, v] of avail) lc.set(k.toLowerCase(), v);
      let okCount = 0;
      const missingSkus: string[] = [];
      for (const it of items) {
        const have = lc.get(it.sku.toLowerCase()) ?? 0;
        if (have >= it.qty) okCount++;
        else missingSkus.push(it.sku);
      }
      return { name: s.title, city: s.city, allOk: missingSkus.length === 0, okCount, total: items.length, missingSkus };
    } catch {
      return { name: s.title, city: s.city, allOk: false, okCount: 0, total: items.length, missingSkus: skus };
    }
  }

  // Begrensde concurrency (chunks van 6) om de neon-http-verbindingen te sparen.
  const result: StoreAvail[] = [];
  for (let i = 0; i < stores.length; i += 6) {
    const chunk = stores.slice(i, i + 6);
    result.push(...(await Promise.all(chunk.map(forStore))));
  }
  return NextResponse.json({ stores: result });
}
