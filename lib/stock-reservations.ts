import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { stockForSkus, stockSyncedAt, onlineBranchSet, type SkuStock } from "@/lib/stock";
import { posDeltaByLocationKey, webReservedAllLocations } from "@/lib/store-core";

/**
 * Order-bewuste voorraad. SRS is alleen WMS/voorraadbron en ziet de webverkopen
 * NIET (geen weborder-push). Tussen twee SRS-syncs zou de site daardoor hetzelfde
 * laatste item meerdere keren kunnen verkopen. Daarom reserveren we kort:
 *
 *   beschikbaar = SRS-voorraad − (web-orderstuks die SRS nog niet verwerkt heeft)
 *
 * Een orderregel telt mee zolang hij betaald-maar-niet-verzonden is, óf verzonden
 * ná de laatste SRS-sync (dan heeft het magazijn 'm wel uitgeboekt, maar de sync
 * heeft dat nog niet opgehaald — model A: magazijn boekt web-picks in SRS uit).
 * Zodra een sync ná de verzending draait, valt de reservering vanzelf vrij.
 *
 * Bewust NIET toegepast in de allocatie-engine (lib/fulfillment): die mag de
 * bruto fysieke voorraad zien, anders zou een order z'n eigen reservering aftrekken.
 */

export async function reservedBySku(skus: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const clean = [...new Set(skus.map((s) => String(s || "").trim()).filter(Boolean))];
  if (!clean.length) return out;
  const syncedAt = (await stockSyncedAt()) ?? new Date(0);
  try {
    const db = getDb();
    const rows = await db.execute<{ sku: string; qty: number }>(sql`
      select ol.sku as sku, sum(ol.quantity)::int as qty
      from order_lines ol
      join orders o on o.id = ol.order_id
      where ol.sku in (${sql.join(clean.map((s) => sql`${s}`), sql`, `)})
        and (
          o.status in ('paid', 'ready_pickup')
          or (o.status in ('shipped', 'delivered') and o.updated_at > ${syncedAt.toISOString()})
        )
      group by ol.sku
    `);
    for (const r of rows.rows) out.set(r.sku, Math.max(0, Number(r.qty) || 0));
  } catch {
    // Bij een fout liever bruto tonen dan de winkel platleggen.
  }
  return out;
}

/**
 * Beschikbaar per artikel voor klant-weergave (PDP/maat), uit de gedeelde core:
 *   per locatie: net = SRS-baseline + kassa/pos-delta − web-reservering
 * total = som over alle locaties; online = som over de online-filialen.
 * Zo ziet de webshop óók de winkelverkopen (pos) en z'n eigen web-reserveringen —
 * één waarheid met de kassa, geen dubbelverkoop. byBranch.qty wordt netto.
 */
export async function availableForSkus(skus: string[]): Promise<Map<string, SkuStock>> {
  const clean = [...new Set(skus.map((s) => String(s || "").trim()).filter(Boolean))];
  const out = new Map<string, SkuStock>();
  if (!clean.length) return out;
  const [gross, posDelta, webRes] = await Promise.all([
    stockForSkus(clean),
    posDeltaByLocationKey(clean),
    webReservedAllLocations(),
  ]);
  const online = onlineBranchSet(); // Set<branchId> of null = alle filialen
  for (const [sku, st] of gross) {
    const keyL = sku.toLowerCase();
    let total = 0;
    let onlineQty = 0;
    const byBranch = st.byBranch.map((b) => {
      const locL = (b.store || "").toLowerCase();
      const pd = posDelta.get(locL)?.get(keyL) || 0; // negatief = kassa-verkoop
      const wr = webRes.get(locL)?.get(keyL) || 0; // door web gereserveerd
      const net = Math.max(0, b.qty + pd - wr);
      total += net;
      if (!online || online.has(b.branchId)) onlineQty += net;
      return { ...b, qty: net };
    });
    out.set(sku, { total, online: onlineQty, byBranch });
  }
  return out;
}
