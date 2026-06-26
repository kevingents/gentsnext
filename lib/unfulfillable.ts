import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, fulfillmentMisses, returns as returnsTable, returnLines as returnLinesTable } from "@/db/schema";
import { getOrderByNumber } from "@/lib/orders";
import { allocateOrder, type FulfillmentPlan } from "@/lib/fulfillment";
import { recordMovements } from "@/lib/store-core";
import { refundMolliePayment } from "@/lib/mollie";
import { createReturnLabel, dhlConfigured, type ReturnAddress } from "@/lib/dhl";

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

/** Open (onopgeloste) niet-leverbaar-meldingen — voor de portal-afhandelingslijst. */
export async function listUnresolvedUnfulfillable(limit = 100) {
  const db = getDb();
  const rows = await db
    .select()
    .from(fulfillmentMisses)
    .where(eq(fulfillmentMisses.outcome, "unresolved"))
    .orderBy(desc(fulfillmentMisses.createdAt))
    .limit(Math.max(1, Math.min(300, limit)));
  // groepeer per order (een set kan meerdere regels hebben)
  const byOrder = new Map<string, { orderNumber: string; store: string; createdAt: Date; skus: { sku: string; qty: number }[] }>();
  for (const r of rows) {
    const cur = byOrder.get(r.orderNumber) || { orderNumber: r.orderNumber, store: r.store, createdAt: r.createdAt, skus: [] };
    cur.skus.push({ sku: r.sku, qty: r.qty });
    byOrder.set(r.orderNumber, cur);
  }
  // verrijk met de regels van de order (titels + of 't een set is)
  const out = [];
  for (const o of byOrder.values()) {
    const data = await getOrderByNumber(o.orderNumber).catch(() => null);
    if (!data) { out.push({ ...o, customer: "", isSet: false, affected: o.skus.map((s) => ({ sku: s.sku, title: s.sku })), setLines: [] }); continue; }
    const missSet = new Set(o.skus.map((s) => s.sku.toLowerCase()));
    const affectedLines = data.lines.filter((l) => missSet.has(l.sku.toLowerCase()));
    const groupIds = new Set(affectedLines.map((l) => l.groupId).filter(Boolean) as string[]);
    const setLines = groupIds.size ? data.lines.filter((l) => l.groupId && groupIds.has(l.groupId)) : affectedLines;
    out.push({
      orderNumber: o.orderNumber,
      store: o.store,
      customer: `${data.order.firstName} ${data.order.lastName}`.trim(),
      createdAt: o.createdAt,
      isSet: setLines.length > affectedLines.length,
      affected: affectedLines.map((l) => ({ sku: l.sku, title: l.title })),
      setLines: setLines.map((l) => ({ sku: l.sku, title: l.title, shipped: !missSet.has(l.sku.toLowerCase()) })),
    });
  }
  return out;
}

/**
 * Make-whole voor een set die niet compleet leverbaar is. mode:
 *  - "cancel": niets verstuurd → de hele set terugbetalen (Mollie).
 *  - "return": een deel is al verstuurd → de set terugbetalen ÉN een systeem-retour
 *    (gratis DHL-label) starten voor het wél-verstuurde deel zodat de klant het
 *    terug kan sturen. Geen dubbele terugbetaling: de retour-`itemsCents` = 0.
 */
export async function resolveUnfulfillable(orderNumber: string, mode: "cancel" | "return", by = ""): Promise<
  | { ok: false; error: string }
  | { ok: true; mode: "cancel" | "return"; refundedCents: number; returnId?: string; labelPending?: boolean }
> {
  const nr = String(orderNumber || "").trim();
  if (!nr) return { ok: false, error: "Geen ordernummer." };
  const data = await getOrderByNumber(nr);
  if (!data) return { ok: false, error: "Order niet gevonden." };
  const { order, lines } = data;
  const db = getDb();

  const missRows = await db.select({ sku: fulfillmentMisses.sku }).from(fulfillmentMisses)
    .where(and(eq(fulfillmentMisses.orderNumber, order.orderNumber), eq(fulfillmentMisses.outcome, "unresolved")));
  const missSet = new Set(missRows.map((r) => r.sku.toLowerCase()));
  if (!missSet.size) return { ok: false, error: "Geen open niet-leverbaar-melding voor deze order." };

  const affectedLines = lines.filter((l) => missSet.has(l.sku.toLowerCase()));
  const groupIds = new Set(affectedLines.map((l) => l.groupId).filter(Boolean) as string[]);
  const setLines = groupIds.size ? lines.filter((l) => l.groupId && groupIds.has(l.groupId)) : affectedLines;
  const refundCents = setLines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);

  // 1. Terugbetalen (de set is onbruikbaar zonder alle delen).
  if (order.molliePaymentId && refundCents > 0) {
    const r = await refundMolliePayment(order.molliePaymentId, refundCents, `Pak niet compleet leverbaar — ${order.orderNumber}`);
    if (!r.ok) return { ok: false, error: r.error || "Terugbetaling mislukt." };
  }

  // 2. Bij 'return': systeem-retour voor het al-verstuurde deel (set minus niet-leverbaar).
  let returnId: string | undefined;
  let labelPending = false;
  if (mode === "return") {
    const shipped = setLines.filter((l) => !missSet.has(l.sku.toLowerCase()));
    if (shipped.length) {
      const [ret] = await db.insert(returnsTable).values({
        orderId: order.id, orderNumber: order.orderNumber, email: order.email,
        status: "requested", method: "dhl", refundType: "money",
        itemsCents: 0, shippingCostCents: 0, // reeds terugbetaald → geen dubbele refund bij ontvangst
        reason: "Pak niet compleet leverbaar — systeemretour",
      }).returning({ id: returnsTable.id });
      returnId = ret.id;
      await db.insert(returnLinesTable).values(shipped.map((l) => ({
        returnId: ret.id, orderLineId: l.id, sku: l.sku, title: l.title, size: l.size || "", color: l.color || "",
        qty: l.quantity, unitPriceCents: l.unitPriceCents, reason: "pak niet compleet",
      })));
      labelPending = true;
      if (dhlConfigured()) {
        const addr: ReturnAddress = {
          name: `${order.firstName} ${order.lastName}`.trim(), street: order.street, number: order.houseNumber,
          postalCode: order.postalCode, city: order.city, country: order.country || "NL", email: order.email,
        };
        const res = await createReturnLabel(order.orderNumber, addr).catch(() => null);
        if (res?.ok) {
          labelPending = false;
          await db.update(returnsTable).set({ status: "label_created", dhlLabelUrl: res.labelUrl || "", dhlTracking: res.tracking || "", updatedAt: sql`now()` }).where(eq(returnsTable.id, ret.id));
        }
      }
    }
  }

  // 3. Meldingen afsluiten.
  await db.update(fulfillmentMisses)
    .set({ outcome: mode === "return" ? "resolved-return" : "resolved-cancel", reroutedTo: by.slice(0, 200) })
    .where(and(eq(fulfillmentMisses.orderNumber, order.orderNumber), inArray(fulfillmentMisses.outcome, ["unresolved"])));

  return { ok: true, mode, refundedCents: refundCents, returnId, labelPending };
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
