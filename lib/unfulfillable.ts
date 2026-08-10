import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, fulfillmentMisses, returns as returnsTable, returnLines as returnLinesTable } from "@/db/schema";
import { getOrderByNumber } from "@/lib/orders";
import { allocateOrder, type FulfillmentPlan } from "@/lib/fulfillment";
import { recordMovements } from "@/lib/store-core";
import { refundMolliePayment } from "@/lib/mollie";
import { reverseOrderLoyalty } from "@/lib/loyalty-claim";
import { createReturnLabel, dhlConfigured, type ReturnAddress } from "@/lib/dhl";
import { findAlternativesForCancelled, alternativeUrl, type AlternativeItem } from "@/lib/alternatives";
import { mailT, sendUnfulfillableRefund } from "@/lib/email";
import { recordEvents } from "@/lib/analytics";
import { getSettings } from "@/lib/settings";
import { getSiteUrl } from "@/lib/site-url";
import { DEFAULT_LOCALE, isLocale, localizedPath, type Locale } from "@/lib/i18n";

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
  | {
      ok: true;
      mode: "cancel" | "return";
      refundedCents: number;
      returnId?: string;
      labelPending?: boolean;
      /** Of de klant het annuleringsbericht kreeg, en met hoeveel alternatieven. */
      mailed?: boolean;
      alternatives?: number;
    }
> {
  const nr = String(orderNumber || "").trim();
  if (!nr) return { ok: false, error: "Geen ordernummer." };
  const data = await getOrderByNumber(nr);
  if (!data) return { ok: false, error: "Order niet gevonden." };
  const { order, lines } = data;
  const db = getDb();

  const missRows = await db.select({ id: fulfillmentMisses.id, sku: fulfillmentMisses.sku }).from(fulfillmentMisses)
    .where(and(eq(fulfillmentMisses.orderNumber, order.orderNumber), eq(fulfillmentMisses.outcome, "unresolved")));
  const missSet = new Set(missRows.map((r) => r.sku.toLowerCase()));
  if (!missSet.size) return { ok: false, error: "Geen open niet-leverbaar-melding voor deze order." };

  const affectedLines = lines.filter((l) => missSet.has(l.sku.toLowerCase()));
  const groupIds = new Set(affectedLines.map((l) => l.groupId).filter(Boolean) as string[]);
  const setLines = groupIds.size ? lines.filter((l) => l.groupId && groupIds.has(l.groupId)) : affectedLines;
  const refundCents = setLines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);

  // 1. Terugbetalen (de set is onbruikbaar zonder alle delen).
  //
  // De idempotency-key is hier geen luxe: de meldingen worden pas ná de refund
  // afgesloten (stap 3), dus twee klikken of een retry na een timeout zouden
  // anders twee keer echt geld terugstorten.
  //
  // De sleutel hangt aan DEZE meldingen, niet aan het ordernummer. Een order kan
  // namelijk later nóg een keer stukvallen op een andere set; met een sleutel per
  // order zou Mollie die tweede terugbetaling herkennen als de eerste, `ok`
  // teruggeven en niets uitbetalen — dan denkt de winkel dat het geld terug is
  // terwijl de klant niets krijgt.
  const refundKey = `unf-${createHash("sha1")
    .update(`${order.orderNumber}|${missRows.map((r) => r.id).sort().join(",")}|${refundCents}`)
    .digest("hex")
    .slice(0, 32)}`;
  let refunded = false;
  if (order.molliePaymentId && refundCents > 0) {
    const r = await refundMolliePayment(
      order.molliePaymentId,
      refundCents,
      `Pak niet compleet leverbaar — ${order.orderNumber}`,
      refundKey,
    );
    if (!r.ok) return { ok: false, error: r.error || "Terugbetaling mislukt." };
    refunded = true;
  }
  // Verdiende punten van de terugbetaalde set terugdraaien (idempotent, gecapt op de
  // gecrediteerde order-punten) — anders houdt de klant punten voor een 100%-refund.
  if (order.customerId && refundCents > 0) {
    try { await reverseOrderLoyalty(order.customerId, order.id, refundCents, `unf-${order.orderNumber}`); }
    catch (e) { console.warn("[unfulfillable] punten terugdraaien mislukt:", (e as Error).message); }
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

  // 4. De klant een bericht sturen, mét alternatieven. Dit was een stille
  //    terugbetaling: geld terug zonder uitleg en zonder uitweg. Best-effort —
  //    het geld is al terug, dus een mailstoring mag de afhandeling niet laten
  //    mislukken (dan zou de operator opnieuw klikken en dus opnieuw refunden).
  const notified = await notifyCancellation({
    order,
    cancelled: setLines,
    orderHandles: lines.map((l) => l.productHandle),
    // Alleen een bedrag noemen als er ook écht is teruggestort. Zonder
    // Mollie-betaling (bv. volledig met een cadeaubon betaald) is er niets
    // teruggeboekt; dan mag de mail dat ook niet beweren.
    refundedCents: refunded ? refundCents : 0,
    partialReturn: mode === "return",
  }).catch((e) => {
    console.error("[unfulfillable] klantbericht mislukt:", (e as Error).message);
    return { mailed: false, alternatives: 0 };
  });

  return { ok: true, mode, refundedCents: refundCents, returnId, labelPending, ...notified };
}

type NotifyLine = {
  productHandle: string;
  title: string;
  size: string | null;
  color: string | null;
  unitPriceCents: number;
};

/** Orderregel zoals de bestelpagina 'm al heeft — genoeg voor de set-logica. */
type OrderLineForAlt = NotifyLine & { sku: string; groupId: string | null };

/**
 * Annuleringsbericht met alternatieven. Vóór een annulering zijn alle winkels al
 * nagekeken, dus "we zoeken nog even verder" is geen optie meer — het enige
 * zinnige aanbod is: dit hebben we wél, nu, in jouw maat.
 *
 * Het meetpunt `alt_offered` telt alleen een verstuurde mail (één per annulering);
 * de kliks komen als `alt_click` binnen via /api/r. Die twee samen geven de
 * doorklikratio. De bestelpagina toont hetzelfde blok maar telt geen extra
 * 'offer' — anders zou elke herlaadbeurt de noemer vervuilen.
 */
async function notifyCancellation(input: {
  order: { orderNumber: string; email: string; firstName: string; locale: string | null; accessToken: string | null };
  cancelled: NotifyLine[];
  orderHandles: string[];
  refundedCents: number;
  partialReturn: boolean;
}): Promise<{ mailed: boolean; alternatives: number }> {
  const cfg = (await getSettings()).unfulfillableConfig;
  if (!cfg.emailEnabled || !input.order.email) return { mailed: false, alternatives: 0 };

  const locale: Locale = isLocale(String(input.order.locale || "")) ? (input.order.locale as Locale) : DEFAULT_LOCALE;
  const alternatives = cfg.alternativesEnabled
    ? await findAlternativesForCancelled({
        cancelled: input.cancelled,
        orderHandles: input.orderHandles,
        limit: cfg.alternativesCount,
      }).catch((e) => {
        console.error("[unfulfillable] alternatieven zoeken mislukt:", (e as Error).message);
        return [] as AlternativeItem[];
      })
    : [];

  const t = await mailT(locale);
  const base = getSiteUrl();
  const q = input.order.accessToken ? `?t=${input.order.accessToken}` : "";
  const mailed = await sendUnfulfillableRefund({
    email: input.order.email,
    firstName: input.order.firstName,
    orderNumber: input.order.orderNumber,
    cancelledTitles: input.cancelled.map((l) => l.title),
    refundedCents: input.refundedCents,
    partialReturn: input.partialReturn,
    alternatives: alternatives.map((a) => ({
      title: a.title,
      imageUrl: a.imageUrl,
      href: alternativeUrl({ handle: a.handle, src: "mail", locale }),
      minPriceCents: a.minPriceCents,
      hasPriceRange: a.hasPriceRange,
    })),
    orderUrl: `${base}${localizedPath(`/bestelling/${input.order.orderNumber}`, locale)}${q}`,
    locale,
    t,
  });

  if (mailed && alternatives.length) {
    try {
      await recordEvents([
        { type: "alt_offered", path: "/bestelling", props: { src: "mail", count: alternatives.length } },
      ]);
    } catch (e) {
      console.error("[unfulfillable] meetpunt alt_offered mislukt:", (e as Error).message);
    }
  }
  return { mailed, alternatives: alternatives.length };
}

/**
 * Wat is er op deze order geannuleerd wegens niet-leverbaar, en wat kunnen we in
 * plaats daarvan aanbieden? Voor de bestelpagina: de klant die de mail kwijt is,
 * ziet hetzelfde aanbod terug op de pagina die hij toch al opent.
 */
export async function getCancelledWithAlternatives(
  orderNumber: string,
  opts: { locale?: Locale; lines?: OrderLineForAlt[] } = {},
): Promise<{ titles: string[]; alternatives: (AlternativeItem & { href: string })[] }> {
  const empty = { titles: [], alternatives: [] };
  const nr = String(orderNumber || "").trim();
  if (!nr) return empty;

  const db = getDb();
  const rows = await db
    .select({ sku: fulfillmentMisses.sku })
    .from(fulfillmentMisses)
    .where(and(eq(fulfillmentMisses.orderNumber, nr), inArray(fulfillmentMisses.outcome, ["resolved-cancel", "resolved-return"])));
  if (!rows.length) return empty;

  // De aanroeper (bestelpagina) heeft de regels meestal al opgehaald.
  const orderLines = opts.lines ?? (await getOrderByNumber(nr))?.lines;
  if (!orderLines?.length) return empty;
  const missSet = new Set(rows.map((r) => r.sku.toLowerCase()));
  const affected = orderLines.filter((l) => missSet.has(l.sku.toLowerCase()));
  if (!affected.length) return empty;

  // Zelfde set-logica als bij de afhandeling: een pak vervalt in z'n geheel.
  const groupIds = new Set(affected.map((l) => l.groupId).filter(Boolean) as string[]);
  const setLines = groupIds.size ? orderLines.filter((l) => l.groupId && groupIds.has(l.groupId)) : affected;

  const cfg = (await getSettings()).unfulfillableConfig;
  if (!cfg.alternativesEnabled) return { titles: setLines.map((l) => l.title), alternatives: [] };

  const locale = opts.locale ?? DEFAULT_LOCALE;
  const alternatives = await findAlternativesForCancelled({
    cancelled: setLines,
    orderHandles: orderLines.map((l) => l.productHandle),
    limit: cfg.alternativesCount,
  }).catch(() => [] as AlternativeItem[]);

  return {
    titles: setLines.map((l) => l.title),
    alternatives: alternatives.map((a) => ({ ...a, href: alternativeUrl({ handle: a.handle, src: "bestelpagina", locale }) })),
  };
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
