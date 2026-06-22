import { inArray, sql, asc } from "drizzle-orm";
import { getDb } from "@/db";
import { products, productImages } from "@/db/schema";
import { extractColorLabel } from "@/lib/colors";

/**
 * Kleurvarianten van hetzelfde model ("ook verkrijgbaar in"). Bron: het
 * SRSERP-metafield group_data — group_data[0].products bevat de gekoppelde
 * producten met hun Shopify-ID en kleurnaam. We resolven die ID's naar onze
 * eigen producten (handle + beeld).
 */
export type ColorSibling = {
  handle: string;
  colorName: string;
  imageUrl: string;
  isCurrent: boolean;
};

export async function getColorSiblings(
  attributes: Record<string, unknown>,
  currentHandle: string
): Promise<ColorSibling[]> {
  const raw = attributes?.group_data;
  if (!raw || typeof raw !== "string") return [];

  let group: any[];
  try {
    group = JSON.parse(raw);
  } catch {
    return [];
  }
  const members: { id: number | string; name: string; pos: number }[] = [];
  for (const g of group || []) {
    for (const p of g?.products || []) {
      const id = p?.id;
      if (id == null) continue;
      members.push({
        id,
        name: p?.product_display_name?.nl || p?.product_display_name?.en || "",
        pos: Number(p?.product_position) || 0,
      });
    }
  }
  if (members.length < 2) return [];

  const gids = members.map((m) => `gid://shopify/Product/${m.id}`);
  const db = getDb();
  const rows = await db
    .select({
      shopifyProductId: products.shopifyProductId,
      handle: products.handle,
      image: sql<string>`(select url from ${productImages} pi where pi.product_id = ${products.id} order by position limit 1)`,
    })
    .from(products)
    .where(inArray(products.shopifyProductId, gids));

  const byGid = new Map(rows.map((r) => [r.shopifyProductId, r]));
  const siblings: ColorSibling[] = [];
  for (const m of members.sort((a, b) => a.pos - b.pos)) {
    const hit = byGid.get(`gid://shopify/Product/${m.id}`);
    if (!hit) continue;
    siblings.push({
      handle: hit.handle,
      // Naam uit de metafield; valt terug op een kleurwoord uit de handle (bv. de
      // huidige variant heeft vaak een lege naam → "Navy" uit de handle).
      colorName: m.name || extractColorLabel(hit.handle),
      imageUrl: hit.image || "",
      isCurrent: hit.handle === currentHandle,
    });
  }
  // Alleen tonen als er naast het huidige product nog minstens één variant is.
  return siblings.filter((s) => s.handle).length >= 2 ? siblings : [];
}
