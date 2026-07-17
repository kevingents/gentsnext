import { and, desc, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, returns } from "@/db/schema";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Order-/retour-/refund-status voor de AI-klantenservice ("waar is mijn
 * bestelling?"). Twee toegangspaden:
 *  - lookupOrderStatusForEmail: op het GEVERIFIEERDE sessie-e-mailadres
 *    (ingelogde klant) — nooit op een vrij ingetikt e-mailadres.
 *  - lookupOrderStatusVerified: gast met ordernummer + postcode-check.
 *
 * De response bevat BEWUST alleen wat de klant al over zichzelf mag zien:
 * status, volg-link, retourstatus en refund-status. Geen naam, adres of
 * e-mail (terug-echoën), en nooit een tegoedbon-code (geld-equivalent) — die
 * ontvangt de klant uitsluitend per e-mail.
 */

export type SupportOrderStatus = {
  orderNumber: string;
  /** ISO-datum van plaatsing. */
  orderedAt: string;
  /** Rauwe orderstatus (open/paid/shipped/…) — voor de widget-weergavelogica. */
  status: string;
  /** Klant-taal, bv. "Onderweg — verzonden op 14 juli". */
  statusText: string;
  /** Volg-link ("" indien niet beschikbaar — gast-pad heeft geen token-loze pagina). */
  trackTraceUrl: string;
  return: { status: string; statusText: string } | null;
  refund: { amountCents: number; statusText: string } | null;
};

function fmtDateNL(d: Date | string | null | undefined): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
  } catch {
    return "";
  }
}

function euro(cents: number): string {
  return `€ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

type OrderRow = typeof orders.$inferSelect;
type ReturnRow = typeof returns.$inferSelect;

/** Orderstatus → klant-zin. updatedAt is de laatste statusovergang (≈ verzend-/bezorgmoment). */
function orderStatusText(o: OrderRow): string {
  const when = fmtDateNL(o.updatedAt);
  switch (o.status) {
    case "open":
      return "Wacht nog op betaling — zodra de betaling binnen is gaan we voor je aan de slag.";
    case "paid":
      return o.deliveryMethod === "pickup"
        ? `Betaald — we leggen je bestelling klaar${o.pickupStore ? ` bij ${o.pickupStore}` : " in de winkel"}. Je krijgt bericht zodra je 'm kunt afhalen.`
        : "Betaald — we maken je pakket klaar voor verzending.";
    case "shipped":
      return `Onderweg naar je${when ? ` — verzonden op ${when}` : ""}.`;
    case "ready_pickup":
      return `Klaar om af te halen${o.pickupStore ? ` bij ${o.pickupStore}` : " in de winkel"}.`;
    case "delivered":
      return `Bezorgd${when ? ` op ${when}` : ""}.`;
    case "refunded":
      return "Terugbetaald.";
    case "canceled":
      return "Geannuleerd.";
    default:
      return "In behandeling.";
  }
}

/** Retourstatus → klant-zin. Retour-tracking (DHL-code) mag mee; tegoedbon-codes NOOIT. */
function returnStatusText(r: ReturnRow): string {
  const when = fmtDateNL(r.updatedAt);
  switch (r.status) {
    case "requested":
      return r.method === "store"
        ? `Retour aangemeld — lever de artikelen in${r.pickupStore ? ` bij ${r.pickupStore}` : " bij een van onze winkels"}.`
        : "Retour aangemeld — het retourlabel volgt per e-mail.";
    case "label_created":
      return `Retourlabel aangemaakt — we hebben je pakket nog niet ontvangen.${r.dhlTracking ? ` Volg je retourzending met DHL-code ${r.dhlTracking}.` : ""}`;
    case "received":
    case "processing":
      return `Je retour is ontvangen${when ? ` (${when})` : ""} en wordt nu verwerkt.`;
    case "completed":
      return r.refundType === "credit"
        ? `Je retour is afgehandeld${when ? ` op ${when}` : ""} — je tegoedbon is per e-mail verstuurd.`
        : `Je retour is afgehandeld${when ? ` op ${when}` : ""}.`;
    default:
      return "Retour in behandeling.";
  }
}

/** Refund-status (alleen bij geld terug of een terugbetaalde order). */
function refundInfo(o: OrderRow, r: ReturnRow | null): { amountCents: number; statusText: string } | null {
  if (o.status === "refunded") {
    return {
      amountCents: o.totalCents,
      statusText: `De betaling (${euro(o.totalCents)}) is terugbetaald. Afhankelijk van je bank staat het binnen 1-3 werkdagen op je rekening.`,
    };
  }
  if (!r || r.refundType !== "money") return null;
  if (r.status === "completed") {
    const when = fmtDateNL(r.updatedAt);
    return {
      amountCents: r.refundedCents,
      statusText: `${euro(r.refundedCents)} is teruggestort${when ? ` op ${when}` : ""}. Afhankelijk van je bank duurt het 1-3 werkdagen voordat het zichtbaar is.`,
    };
  }
  const expected = Math.max(0, r.itemsCents - r.shippingCostCents);
  if (r.status === "received" || r.status === "processing") {
    return {
      amountCents: expected,
      statusText: `Je retour wordt verwerkt — daarna storten we ${euro(expected)} terug, meestal binnen enkele werkdagen.`,
    };
  }
  return {
    amountCents: expected,
    statusText: `De terugbetaling van ${euro(expected)} start zodra we je retour hebben ontvangen.`,
  };
}

/** Laatste niet-geannuleerde retour per order-id. */
async function latestReturnsByOrderId(orderIds: string[]): Promise<Map<string, ReturnRow>> {
  const map = new Map<string, ReturnRow>();
  if (!orderIds.length) return map;
  const db = getDb();
  const rows = await db
    .select()
    .from(returns)
    .where(and(inArray(returns.orderId, orderIds), sql`${returns.status} <> 'cancelled'`))
    .orderBy(desc(returns.createdAt));
  for (const r of rows) if (!map.has(r.orderId)) map.set(r.orderId, r);
  return map;
}

function toStatus(o: OrderRow, ret: ReturnRow | null, opts: { includeTrackUrl: boolean }): SupportOrderStatus {
  return {
    orderNumber: o.orderNumber,
    orderedAt: o.createdAt ? new Date(o.createdAt).toISOString() : "",
    status: o.status,
    statusText: orderStatusText(o),
    // Alleen voor de ingelogde eigenaar: de bestelpagina werkt dan zonder token.
    // Het gast-pad krijgt GEEN link — de token-URL zou de volledige orderpagina
    // (naam/adres) ontsluiten op basis van de zwakkere postcode-check.
    trackTraceUrl: opts.includeTrackUrl ? `${getSiteUrl()}/bestelling/${encodeURIComponent(o.orderNumber)}` : "",
    return: ret ? { status: ret.status, statusText: returnStatusText(ret) } : null,
    refund: refundInfo(o, ret),
  };
}

/**
 * Recente orders (max 3) van de INGELOGDE klant, op het geverifieerde
 * sessie-e-mailadres. Excl. onbetaald/mislukt/verlopen/geannuleerd — dezelfde
 * "echte orders"-definitie als het kassa-klant-paneel.
 */
export async function lookupOrderStatusForEmail(email: string, limit = 3): Promise<SupportOrderStatus[]> {
  const norm = String(email || "").trim().toLowerCase();
  if (!norm) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(orders)
    .where(sql`lower(${orders.email}) = ${norm} and ${orders.status} not in ('open','failed','expired','canceled')`)
    .orderBy(desc(orders.createdAt))
    .limit(Math.max(1, Math.min(5, limit)));
  const retBy = await latestReturnsByOrderId(rows.map((o) => o.id));
  return rows.map((o) => toStatus(o, retBy.get(o.id) || null, { includeTrackUrl: true }));
}

/** Uniforme fout voor het gast-pad — bewust identiek bij onbekend nummer én postcode-mismatch (geen enumeratie-oracle). */
export const ORDER_LOOKUP_NOT_FOUND = "Deze combinatie van ordernummer en postcode is niet gevonden.";

/**
 * Eén order voor een GAST, geverifieerd met ordernummer + postcode (het bezorg-/
 * factuuradres van de order; genormaliseerd: hoofdletters, spaties eruit). Bij
 * geen match of onbekend nummer: null — de aanroeper toont ORDER_LOOKUP_NOT_FOUND.
 */
export async function lookupOrderStatusVerified(orderNr: string, postcode: string): Promise<SupportOrderStatus | null> {
  const nr = String(orderNr || "").trim().toUpperCase();
  const pc = String(postcode || "").replace(/\s+/g, "").toUpperCase();
  // Vroege vormcheck (zelfde uniforme uitkomst als een miss).
  if (!/^[A-Z0-9-]{5,24}$/.test(nr) || pc.length < 4 || pc.length > 10) return null;
  const db = getDb();
  // Eén query met beide voorwaarden: onbekend nummer en verkeerde postcode zijn
  // niet te onderscheiden (uniforme fout + vergelijkbare timing).
  const rows = await db
    .select()
    .from(orders)
    .where(sql`upper(${orders.orderNumber}) = ${nr} and upper(replace(${orders.postalCode}, ' ', '')) = ${pc}`)
    .limit(1);
  const order = rows[0];
  if (!order) return null;
  const retBy = await latestReturnsByOrderId([order.id]);
  return toStatus(order, retBy.get(order.id) || null, { includeTrackUrl: false });
}

/**
 * Compacte NL-tekstweergave van de statussen — als GEVERIFIEERDE context voor
 * de AI (grounding: de AI mag alleen deze feiten noemen).
 */
export function formatOrderStatusContext(list: SupportOrderStatus[]): string {
  if (!list.length) return "";
  return list
    .map((o) => {
      const parts = [
        `BESTELLING ${o.orderNumber} (geplaatst op ${fmtDateNL(o.orderedAt) || "onbekend"}):`,
        `- Status: ${o.statusText}`,
      ];
      if (o.trackTraceUrl) parts.push(`- Volg-link: ${o.trackTraceUrl}`);
      if (o.return) parts.push(`- Retour: ${o.return.statusText}`);
      if (o.refund) parts.push(`- Terugbetaling: ${o.refund.statusText}`);
      return parts.join("\n");
    })
    .join("\n\n");
}
