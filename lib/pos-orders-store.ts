import { put, list } from "@vercel/blob";

/**
 * POS-order-sidecar: kassabestellingen (endless aisle) krijgen een normale order +
 * Mollie-betaling via de gewone checkout-flow. De WINKEL-attributie (welk filiaal de
 * bestelling plaatste, kanaal=pos, medewerker) leggen we hier ernaast — bewust NIET
 * als kolom op `orders` (dat zou een live-migratie vragen die de checkout kan breken).
 * Zo valt de omzet later toe te rekenen aan het filiaal zonder DB-risico.
 * Blob: pos/orders.json  { [orderNumber]: { storeName, channel, staff, at } }.
 */

const PATH = "pos/orders.json";

function blobToken(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}

export type PosOrderMeta = { orderNumber: string; storeName: string; channel: string; staff?: string; at: string };

async function readAll(): Promise<Record<string, PosOrderMeta>> {
  try {
    const { blobs } = await list({ prefix: PATH, limit: 1, token: blobToken() });
    const b = (blobs || []).find((x) => x.pathname === PATH);
    if (!b) return {};
    const res = await fetch(`${b.url}?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, PosOrderMeta>;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

/** Leg de winkel-attributie van een POS-order vast (gecapt tegen ongebreidelde groei). */
export async function recordPosOrder(meta: { orderNumber: string; storeName: string; staff?: string }): Promise<void> {
  const all = await readAll();
  all[meta.orderNumber] = {
    orderNumber: meta.orderNumber,
    storeName: String(meta.storeName || "").trim(),
    channel: "pos",
    staff: meta.staff ? String(meta.staff) : undefined,
    at: new Date().toISOString(),
  };
  // Cap: bewaar de laatste ~5000 op insert-volgorde (nieuwe achteraan).
  const entries = Object.values(all).sort((a, b) => (a.at < b.at ? -1 : 1)).slice(-5000);
  const next: Record<string, PosOrderMeta> = {};
  for (const e of entries) next[e.orderNumber] = e;
  await put(PATH, JSON.stringify(next), { access: "public", allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 0, token: blobToken() });
}

export async function getPosOrders(): Promise<PosOrderMeta[]> {
  const all = await readAll();
  return Object.values(all).sort((a, b) => (a.at < b.at ? 1 : -1));
}
