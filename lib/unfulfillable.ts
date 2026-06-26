import { desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, fulfillmentMisses } from "@/db/schema";
import { getOrderByNumber } from "@/lib/orders";
import { allocateOrder, type FulfillmentPlan } from "@/lib/fulfillment";
import { recordMovements } from "@/lib/store-core";

/**
 * "Niet leverbaar" — een winkel kan een toegewezen weborder-regel niet leveren.
 * We doen drie dingen:
 *  1. Voorraad corrigeren: het fantoom-stuk eraf op die winkel (SRS schatte te
 *     hoog) zodat het niet opnieuw verkocht/gerouteerd wordt.
 *  2. Her-alloceren: de order opnieuw plannen mét die winkel uitgesloten →
 *     magazijn-eerst, anders een andere winkel met voorraad.
 *  3. Loggen per winkel (miss-rate → betrouwbaarheidssignaal).
 * Lukt het her-alloceren niet, dan geven we de set-context terug zodat de operator
 * de make-whole kan kiezen (hele set annuleren + terugbetalen, of — als er al een
 * deel verstuurd is — een retour voor dat deel starten).
 */

export type UnfulfillableResult =
  | { ok: false; error: string }
  | { ok: true; outcome: "rerouted"; from: string; to: string[]; lines: { sku: string; title: string }[] }
  | {
      ok: true;
      outcome: "unresolved";
      isSet: boolean;
      affected: { sku: string; title: string }[];
      setLines: { sku: string; title: string }[];
    };

export async function reportUnfulfillable(
  orderNumber: string,
  store: string,
  items: { sku: string; qty: number }[],
  reason = "",
): Promise<UnfulfillableResult> {
  const nr = String(orderNumber || "").trim();
  const st = String(store || "").trim();
  const picked = (items || []).map((i) => ({ sku: String(i.sku || "").trim(), qty: Math.max(1, Math.round(Number(i.qty) || 1)) })).filter((i) => i.sku);
  if (!nr || !st || !picked.length) return { ok: false, error: "Ordernummer, winkel en artikelen zijn vereist." };

  const data = await getOrderByNumber(nr);
  if (!data) return { ok: false, error: "Order niet gevonden." };
  const { order, lines } = data;
  const plan = (order.fulfillmentPlan ?? null) as FulfillmentPlan | null;
  const failedShip = plan?.shipments?.find((s) => String(s.store || "").toLowerCase() === st.toLowerCase());
  const excludeBranchIds = failedShip?.branchId ? [String(failedShip.branchId)] : [];

  // 1. Voorraad corrigeren (fantoom-stuk eraf op die winkel).
  try {
    await recordMovements({
      location: st,
      channel: "correction",
      reason: `niet leverbaar (${nr})`,
      ref: `${nr}:unavail:${st}`,
      sign: -1,
      lines: picked.map((i) => ({ sku: i.sku, qty: i.qty })),
    });
  } catch (e) {
    console.error("[unfulfillable] voorraad-correctie mislukt:", (e as Error).message);
  }

  // 2. Her-alloceren met die winkel uitgesloten.
  const newPlan = await allocateOrder(
    lines.map((l) => ({ sku: l.sku, qty: l.quantity, title: l.title, groupId: l.groupId ?? undefined })),
    { country: order.country || "NL", excludeBranchIds },
  );
  const affected = new Set(picked.map((i) => i.sku.toLowerCase()));
  const stillShort = newPlan.shortages.some((shrt) => affected.has(shrt.sku.toLowerCase()));
  const db = getDb();

  if (!stillShort && newPlan.shipments.length) {
    await db.update(orders).set({ fulfillmentPlan: newPlan, updatedAt: sql`now()` }).where(eq(orders.id, order.id));
    const to = [...new Set(newPlan.shipments.filter((s) => s.lines.some((l) => affected.has(l.sku.toLowerCase()))).map((s) => s.store))];
    await logMisses(order, st, picked, reason, "rerouted", to.join(", "));
    const affLines = lines.filter((l) => affected.has(l.sku.toLowerCase())).map((l) => ({ sku: l.sku, title: l.title }));
    return { ok: true, outcome: "rerouted", from: st, to, lines: affLines };
  }

  // Niet te sourcen → context teruggeven voor de make-whole.
  const affectedLines = lines.filter((l) => affected.has(l.sku.toLowerCase()));
  const groupIds = new Set(affectedLines.map((l) => l.groupId).filter(Boolean) as string[]);
  const setLines = lines.filter((l) => l.groupId && groupIds.has(l.groupId));
  const isSet = setLines.length > affectedLines.length; // andere regels in dezelfde set (pak)
  await logMisses(order, st, picked, reason, "unresolved", "");
  return {
    ok: true,
    outcome: "unresolved",
    isSet,
    affected: affectedLines.map((l) => ({ sku: l.sku, title: l.title })),
    setLines: setLines.map((l) => ({ sku: l.sku, title: l.title })),
  };
}

async function logMisses(order: { id: string; orderNumber: string }, store: string, items: { sku: string; qty: number }[], reason: string, outcome: string, to: string) {
  const db = getDb();
  await db.insert(fulfillmentMisses).values(
    items.map((i) => ({
      orderId: order.id,
      orderNumber: order.orderNumber,
      store,
      sku: i.sku,
      qty: i.qty,
      reason: String(reason || "").slice(0, 300),
      outcome,
      reroutedTo: to.slice(0, 200),
    })),
  );
}

export type StoreReliability = { store: string; misses: number; rerouted: number; unresolved: number };

/** Miss-rate per winkel over N dagen — voor het betrouwbaarheidssignaal (fase 2). */
export async function getFulfillmentMissesByStore(days = 90): Promise<StoreReliability[]> {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400000);
  const rows = await db
    .select({
      store: fulfillmentMisses.store,
      misses: sql<number>`count(*)::int`,
      rerouted: sql<number>`sum(case when ${fulfillmentMisses.outcome} = 'rerouted' then 1 else 0 end)::int`,
      unresolved: sql<number>`sum(case when ${fulfillmentMisses.outcome} = 'unresolved' then 1 else 0 end)::int`,
    })
    .from(fulfillmentMisses)
    .where(gte(fulfillmentMisses.createdAt, since))
    .groupBy(fulfillmentMisses.store)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ store: r.store, misses: Number(r.misses) || 0, rerouted: Number(r.rerouted) || 0, unresolved: Number(r.unresolved) || 0 }));
}
