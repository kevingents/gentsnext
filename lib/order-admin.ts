import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customers, orderLogboek, orders, products, productVariants } from "@/db/schema";
import {
  attachMolliePayment,
  applyPaymentStatus,
  confirmAndPlan,
  createOrder,
  finalizeGiftcardCoveredOrder,
  getOrderByNumber,
  releaseOrderGiftcard,
  sendOrderConfirmationOnce,
  updateOrderStatus,
  voidUnpaidOrder,
  type CheckoutContact,
  type CheckoutItem,
  type DeliveryMethod,
} from "@/lib/orders";
import {
  createMolliePayment,
  getMolliePayment,
  mollieConfigured,
  refundMolliePayment,
  type MolliePayment,
} from "@/lib/mollie";
import {
  magNieuweBetaallink,
  terugbetaalRuimte,
  schoonRefundBedrag,
  refundSleutel,
  betaallinkSleutel,
  isSynthetischeBetaalref,
} from "@/lib/order-acties-regels";
import { redeemVoucher, releaseVoucher } from "@/lib/vouchers";
import { reverseOrderLoyalty } from "@/lib/loyalty-claim";
import { availableForSkus } from "@/lib/stock-reservations";
import { availableInStore } from "@/lib/store-core";
import { countOrderHolds, releaseOrderHolds, renewOrderHolds, reserveOrderStock, WEB_POOL, type ReserveRequest } from "@/lib/store-reserve";
import { sendPaymentLinkMail } from "@/lib/email";
import { getSiteUrl } from "@/lib/site-url";

/**
 * BACK-OFFICE-ACTIES OP EEN BESTELLING (portal → Site → Bestellingen).
 *
 * Alles wat een medewerker met een bestaande of nieuwe bestelling moet kunnen
 * doen zónder in Mollie of de database te duiken: handmatig bestellen voor een
 * klant, een nieuwe betaallink sturen als de betaling mislukte, terugbetalen,
 * de betaalstatus bij Mollie ophalen als de webhook is gemist, annuleren, en de
 * bevestigingsmail opnieuw sturen.
 *
 * DRIE UITGANGSPUNTEN
 *
 *  1. Hergebruik het bestaande betaalpad. Een handmatige bestelling loopt door
 *     dezelfde `createOrder` als de webshop: prijzen uit de database, voorraad
 *     atomair geclaimd, voucher server-side gevalideerd. Er is hier geen
 *     tweede, soepelere manier om een order te maken — dat is precies hoe
 *     bedragen gaan afwijken van wat de klant ziet.
 *
 *  2. Geldacties zijn expliciet en herhaalbaar. Elke Mollie-aanroep draagt een
 *     idempotency-sleutel (lib/order-acties-regels) zodat een dubbele klik geen
 *     tweede betaling of tweede terugstorting oplevert. Het maximum van een
 *     terugbetaling komt van Mollie, niet uit onze eigen kolommen.
 *
 *  3. Elke actie laat een spoor na (order_logboek) mét de portal-gebruiker.
 *     Het schrijven van dat spoor is fail-soft: de migratie draait niet
 *     automatisch mee met een deploy (bewuste afspraak), dus zolang de tabel
 *     nog niet bestaat moeten de knoppen gewoon werken.
 */

export type ActieContext = { actor?: string };

/** Wat elke actie teruggeeft; `waarschuwing` = gelukt, maar met een kanttekening. */
export type ActieResultaat = {
  ok: boolean;
  error?: string;
  waarschuwing?: string;
  [k: string]: unknown;
};

const BETAALD = ["paid", "shipped", "ready_pickup", "delivered"];

/* ────────────────────────────── logboek ────────────────────────────── */

export type LogboekActie =
  | "aangemaakt"
  | "betaallink"
  | "terugbetaald"
  | "betaalstatus"
  | "geannuleerd"
  | "bevestiging"
  | "status";

/**
 * Schrijf één regel in het logboek. FAIL-SOFT: een ontbrekende tabel (migratie
 * nog niet gedraaid op productie) of een trage database mag nooit de actie zelf
 * laten mislukken — het geld is dan al onderweg. Wel luid loggen, zodat een
 * ontbrekend spoor zichtbaar is in de serverlogs.
 */
export async function logboekSchrijf(e: {
  orderId?: string | null;
  orderNumber: string;
  actie: LogboekActie;
  actor?: string;
  notitie?: string;
  bedragCents?: number;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await getDb()
      .insert(orderLogboek)
      .values({
        orderId: e.orderId ?? null,
        orderNumber: e.orderNumber,
        actie: e.actie,
        actor: (e.actor || "").slice(0, 120),
        notitie: (e.notitie || "").slice(0, 500),
        bedragCents: Math.round(Number(e.bedragCents) || 0),
        meta: e.meta ?? null,
      });
  } catch (err) {
    console.error("[order-logboek] schrijven mislukt:", e.orderNumber, e.actie, (err as Error).message);
  }
}

export type LogboekRegel = {
  id: string;
  actie: string;
  actor: string;
  notitie: string;
  bedragCents: number;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

/** Tijdlijn van één order (nieuwste eerst). Lege lijst als de tabel nog niet bestaat. */
export async function logboekVoorOrder(orderNumber: string, limit = 40): Promise<LogboekRegel[]> {
  try {
    const rows = await getDb()
      .select({
        id: orderLogboek.id,
        actie: orderLogboek.actie,
        actor: orderLogboek.actor,
        notitie: orderLogboek.notitie,
        bedragCents: orderLogboek.bedragCents,
        meta: orderLogboek.meta,
        createdAt: orderLogboek.createdAt,
      })
      .from(orderLogboek)
      .where(eq(orderLogboek.orderNumber, orderNumber))
      .orderBy(desc(orderLogboek.createdAt))
      .limit(Math.min(200, Math.max(1, limit)));
    return rows.map((r) => ({
      id: r.id,
      actie: r.actie,
      actor: r.actor,
      notitie: r.notitie,
      bedragCents: r.bedragCents,
      meta: (r.meta as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }));
  } catch {
    return [];
  }
}

/* ─────────────────────────── betaal-momentopname ─────────────────────────── */

export type BetaalOverzicht = {
  /** Momentopname bij Mollie; null als er geen (echte) betaling is of Mollie plat ligt. */
  mollie: {
    id: string;
    status: string;
    method: string | null;
    amountCents: number;
    refundedCents: number;
    remainingCents: number | null;
  } | null;
  /** Maximaal terug te betalen bedrag in centen (0 = niets). */
  refundMaxCents: number;
  /** Waarom er niets terug kan — alleen gevuld als refundMaxCents 0 is. */
  refundReden?: string;
  /** Mag deze order een (nieuwe) betaallink? */
  betaallinkMag: boolean;
  betaallinkReden?: string;
};

async function mollieMomentopname(paymentRef: string | null | undefined): Promise<MolliePayment | null> {
  const ref = String(paymentRef || "");
  if (!ref || isSynthetischeBetaalref(ref) || !mollieConfigured()) return null;
  try {
    return await getMolliePayment(ref);
  } catch (e) {
    // Mollie onbereikbaar is geen 500 voor de orderpagina: de rest van het
    // scherm klopt nog, alleen de terugbetaalknop blijft uit.
    console.warn("[order-admin] Mollie-status ophalen mislukt:", ref, (e as Error).message);
    return null;
  }
}

/** Betaal-context voor de orderpagina: wat kan er nu wél en niet met deze order. */
export async function betaalOverzicht(orderNumber: string): Promise<BetaalOverzicht | null> {
  const data = await getOrderByNumber(orderNumber);
  if (!data) return null;
  const o = data.order;
  const p = await mollieMomentopname(o.molliePaymentId);
  const ruimte = terugbetaalRuimte(o, p);
  const link = magNieuweBetaallink(o);
  return {
    mollie: p
      ? { id: p.id, status: p.status, method: p.method, amountCents: p.amountCents, refundedCents: p.refundedCents, remainingCents: p.remainingCents }
      : null,
    refundMaxCents: ruimte.maxCents,
    refundReden: ruimte.reden,
    betaallinkMag: link.ok,
    betaallinkReden: link.error,
  };
}

/* ─────────────────────────── nieuwe betaallink ─────────────────────────── */

type OrderRij = NonNullable<Awaited<ReturnType<typeof getOrderByNumber>>>["order"];
type OrderRegel = NonNullable<Awaited<ReturnType<typeof getOrderByNumber>>>["lines"][number];

/**
 * Claim de voorraad van een bestaande order opnieuw — alleen als er geen
 * lopende hold meer is. Zelfde rekenwijze als `createOrder`: afhalen claimt in
 * de afhaalwinkel, bezorgen in de online-pool.
 */
async function herclaimVoorraad(o: OrderRij, lines: OrderRegel[]): Promise<{ ok: boolean; tekorten: string[] }> {
  if (await countOrderHolds(o.id) > 0) {
    // Nog geldig geclaimd → alleen verlengen tot ná het nieuwe betaalvenster.
    await renewOrderHolds(o.id, 1440);
    return { ok: true, tekorten: [] };
  }
  const skuList = [...new Set(lines.map((l) => l.sku).filter(Boolean))];
  if (!skuList.length) return { ok: true, tekorten: [] };
  const isPickup = o.deliveryMethod === "pickup";
  const grossBySku = new Map<string, number>();
  if (isPickup) {
    const avail = await availableInStore((o.pickupStore || "").trim(), skuList, { channel: "web" });
    for (const s of skuList) grossBySku.set(s, avail.get(s) ?? 0);
  } else {
    const avail = await availableForSkus(skuList);
    for (const s of skuList) grossBySku.set(s, Math.max(0, avail.get(s)?.online ?? 0));
  }
  const reserveLoc = isPickup ? (o.pickupStore || "").trim() : WEB_POOL;
  const requests: ReserveRequest[] = lines.map((l) => ({
    location: reserveLoc,
    stockKey: l.sku,
    qty: l.quantity,
    gross: grossBySku.get(l.sku) ?? 0,
  }));
  const res = await reserveOrderStock(o.id, requests, 1440);
  if (res.ok) return { ok: true, tekorten: [] };
  const titels = lines
    .filter((l) => res.failed.includes(l.sku.toLowerCase()) || res.failed.includes(l.sku))
    .map((l) => l.title)
    .filter((v, i, a) => a.indexOf(v) === i);
  return { ok: false, tekorten: titels.length ? titels : res.failed };
}

/**
 * Maak een nieuwe betaallink voor een onbetaalde bestelling en (optioneel) mail
 * 'm naar de klant.
 *
 * De volgorde is bewust: eerst de claims herstellen (voucher + voorraad), dan
 * pas de betaling aanmaken. Andersom zou de klant een geldige link krijgen voor
 * spullen die intussen aan iemand anders verkocht zijn. Faalt Mollie ná het
 * herstellen, dan draaien we het herstel weer terug — anders houdt een mislukte
 * poging de voorraad vast en de kortingscode bezet.
 *
 * De cadeaubon-uitzondering staat in lib/order-acties-regels: een bon die bij de
 * mislukte betaling is teruggeboekt, kan niet nog eens op ditzelfde ordernummer
 * worden afgeschreven. Zo'n order krijgt geen tweede link.
 */
export async function nieuweBetaallink(
  orderNumber: string,
  opts: ActieContext & { mail?: boolean } = {},
): Promise<ActieResultaat> {
  const data = await getOrderByNumber(orderNumber);
  if (!data) return { ok: false, error: "Bestelling niet gevonden." };
  const o = data.order;

  const mag = magNieuweBetaallink(o);
  if (!mag.ok) return { ok: false, error: mag.error };
  if (!mollieConfigured()) return { ok: false, error: "Mollie is niet geconfigureerd — er kan geen betaallink gemaakt worden." };

  // 1. Claims herstellen (alleen na een teruggedraaide poging).
  let voucherHersteld = false;
  if (mag.herstelNodig && o.voucherCode) {
    const ok = await redeemVoucher(o.voucherCode);
    if (!ok) {
      return {
        ok: false,
        error: `Kortingscode ${o.voucherCode} is inmiddels gebruikt of verlopen — deze bestelling kan niet meer voor dit bedrag betaald worden. Maak een nieuwe bestelling.`,
      };
    }
    voucherHersteld = true;
  }
  const voorraad = await herclaimVoorraad(o, data.lines);
  if (!voorraad.ok) {
    if (voucherHersteld) await releaseVoucher(o.voucherCode);
    return { ok: false, error: `Niet meer op voorraad: ${voorraad.tekorten.join(", ")}. De bestelling kan niet opnieuw aangeboden worden.` };
  }

  // 2. Betaling aanmaken.
  const origin = getSiteUrl();
  const confirmUrl = `${origin}/bestelling/${o.orderNumber}?t=${o.accessToken || ""}`;
  let checkoutUrl = "";
  let paymentId = "";
  try {
    const payment = await createMolliePayment({
      amountCents: o.totalCents,
      description: `GENTS bestelling ${o.orderNumber}`,
      redirectUrl: confirmUrl,
      cancelUrl: `${origin}/afrekenen?geannuleerd=1`,
      webhookUrl: `${origin}/api/webhooks/mollie`,
      metadata: { orderNumber: o.orderNumber, bron: "backoffice" },
      idempotencyKey: betaallinkSleutel(o.id, Date.now()),
    });
    if (!payment.checkoutUrl) throw new Error("Mollie gaf geen betaal-URL terug.");
    checkoutUrl = payment.checkoutUrl;
    paymentId = payment.id;
  } catch (e) {
    // Terugdraaien wat we net geclaimd hebben — anders blijft de voorraad hangen
    // aan een order die niemand kán betalen.
    if (mag.herstelNodig) {
      await releaseOrderHolds(o.id);
      if (voucherHersteld) await releaseVoucher(o.voucherCode);
    }
    return { ok: false, error: `Betaling starten mislukte: ${(e as Error).message}` };
  }

  // 3. Order aan de nieuwe betaling hangen. attachMolliePayment zet
  //    payment_status op 'open' en verlengt de hold; de order-status zetten we
  //    terug op 'open' zodat 'ie niet als "mislukt" in de lijst blijft staan.
  await attachMolliePayment(o.id, paymentId);
  await getDb()
    .update(orders)
    .set({ status: "open", updatedAt: sql`now()` })
    .where(and(eq(orders.id, o.id), sql`${orders.status} <> 'open'`));

  // 4. Mailen (optioneel — de link is ook te kopiëren).
  let gemaild = false;
  let mailFout = "";
  if (opts.mail) {
    try {
      gemaild = await sendPaymentLinkMail({
        email: o.email,
        firstName: o.firstName,
        orderNumber: o.orderNumber,
        checkoutUrl,
        totalCents: o.totalCents,
        opnieuw: mag.herstelNodig || Boolean(o.molliePaymentId),
        items: data.lines.map((l) => ({ title: l.title, size: l.size, color: l.color, qty: l.quantity, unitPriceCents: l.unitPriceCents })),
      });
      if (!gemaild) mailFout = "De mail is niet door de mailserver geaccepteerd.";
    } catch (e) {
      mailFout = (e as Error).message;
    }
  }

  await logboekSchrijf({
    orderId: o.id,
    orderNumber: o.orderNumber,
    actie: "betaallink",
    actor: opts.actor,
    notitie: opts.mail ? (gemaild ? `Betaallink gemaild naar ${o.email}` : `Betaallink gemaakt; mailen mislukte (${mailFout})`) : "Betaallink gemaakt (niet gemaild)",
    bedragCents: o.totalCents,
    meta: { paymentId, hersteld: mag.herstelNodig },
  });

  return {
    ok: true,
    checkoutUrl,
    paymentId,
    gemaild,
    waarschuwing: mailFout ? `De betaallink staat klaar, maar de mail ging niet weg: ${mailFout}` : undefined,
  };
}

/* ────────────────────────────── terugbetalen ────────────────────────────── */

/**
 * Betaal (een deel van) een bestelling terug via Mollie.
 *
 * Het maximum komt van Mollie zelf (amountRemaining) — die weet wat er al terug
 * is, wij niet. Een volledige terugbetaling zet de order op 'refunded' en
 * stuurt de klant de bijbehorende statusmail; bij een DEELbedrag gebeurt dat
 * bewust niet: de bestelling loopt dan gewoon door en een "terugbetaald"-mail
 * zou de klant op het verkeerde been zetten.
 *
 * Spaarpunten draaien we per terugbetaling terug, met de Mollie-refund-id als
 * referentie — dat maakt het idempotent zonder eigen boekhouding.
 */
export async function terugbetalen(
  orderNumber: string,
  bedragCents: number,
  opts: ActieContext & { reden?: string } = {},
): Promise<ActieResultaat> {
  const data = await getOrderByNumber(orderNumber);
  if (!data) return { ok: false, error: "Bestelling niet gevonden." };
  const o = data.order;

  const betaling = await mollieMomentopname(o.molliePaymentId);
  const ruimte = terugbetaalRuimte(o, betaling);
  if (ruimte.maxCents <= 0) return { ok: false, error: ruimte.reden || "Er kan niets terugbetaald worden." };

  const bedrag = schoonRefundBedrag(bedragCents, ruimte.maxCents);
  if (bedrag <= 0) return { ok: false, error: "Vul een bedrag in dat groter is dan € 0." };

  const reden = String(opts.reden || "").trim();
  const r = await refundMolliePayment(
    String(o.molliePaymentId),
    bedrag,
    `Terugbetaling ${o.orderNumber}`,
    refundSleutel(o.id, bedrag, Date.now()),
  );
  if (!r.ok) return { ok: false, error: r.error || "Terugbetalen mislukte bij Mollie." };

  const volledig = bedrag >= ruimte.maxCents;

  // Punten terugdraaien over het teruggestorte bedrag (best-effort: het geld is
  // al onderweg, een puntenfout mag dat niet als "mislukt" laten terugmelden).
  if (o.customerId) {
    try {
      await reverseOrderLoyalty(o.customerId, o.id, bedrag, `refund-${r.id || bedrag}`);
    } catch (e) {
      console.warn("[order-admin] punten terugdraaien mislukt:", o.orderNumber, (e as Error).message);
    }
  }

  let statusFout = "";
  if (volledig) {
    // Zet 'refunded' + stuur de klant de statusmail (zelfde pad als de
    // statusknop). Mislukt dat, dan is het geld tóch terug — melden, niet falen.
    try {
      await updateOrderStatus(o.id, "refunded");
    } catch (e) {
      statusFout = (e as Error).message;
    }
  }

  await logboekSchrijf({
    orderId: o.id,
    orderNumber: o.orderNumber,
    actie: "terugbetaald",
    actor: opts.actor,
    notitie: `${volledig ? "Volledig" : "Deels"} terugbetaald${reden ? ` — ${reden}` : ""}`,
    bedragCents: bedrag,
    meta: { refundId: r.id, volledig, paymentId: o.molliePaymentId },
  });

  return {
    ok: true,
    refundId: r.id,
    bedragCents: bedrag,
    volledig,
    restantCents: Math.max(0, ruimte.maxCents - bedrag),
    waarschuwing: statusFout
      ? `Het bedrag is teruggestort, maar de orderstatus bijwerken mislukte (${statusFout}) — zet 'm handmatig op "Terugbetaald".`
      : undefined,
  };
}

/* ─────────────────────── betaalstatus ophalen (webhook gemist) ─────────────────────── */

/**
 * Haal de betaalstatus op bij Mollie en verwerk 'm alsnog. Voor het geval de
 * webhook nooit binnenkwam (Mollie-storing, deploy op precies dat moment): de
 * klant heeft betaald, maar de bestelling staat nog op 'open' en zit in geen
 * enkele piklijst. Draait exact hetzelfde pad als de webhook, dus idempotent.
 */
export async function betaalstatusVernieuwen(orderNumber: string, opts: ActieContext = {}): Promise<ActieResultaat> {
  const data = await getOrderByNumber(orderNumber);
  if (!data) return { ok: false, error: "Bestelling niet gevonden." };
  const o = data.order;
  const ref = String(o.molliePaymentId || "");
  if (!ref) return { ok: false, error: "Deze bestelling heeft geen betaling om op te halen." };
  if (isSynthetischeBetaalref(ref)) return { ok: false, error: "Deze bestelling is niet via Mollie betaald — er valt niets op te halen." };
  if (!mollieConfigured()) return { ok: false, error: "Mollie is niet geconfigureerd." };

  let payment: MolliePayment;
  try {
    payment = await getMolliePayment(ref);
  } catch (e) {
    return { ok: false, error: `Mollie antwoordde niet: ${(e as Error).message}` };
  }

  const vorige = o.status;
  await applyPaymentStatus(payment.id, payment.status);
  if (payment.status === "paid" || payment.status === "authorized") {
    try {
      await confirmAndPlan(payment.id);
    } catch (e) {
      // Bevestiging/planning heeft z'n eigen claim en wordt vanzelf opnieuw
      // aangeboden; de statuswijziging zelf is al binnen.
      console.error("[order-admin] confirmAndPlan na handmatige sync:", o.orderNumber, (e as Error).message);
    }
  } else if (["canceled", "expired", "failed"].includes(payment.status)) {
    await releaseOrderGiftcard(payment.id);
  }

  const na = await getOrderByNumber(orderNumber);
  const nieuw = na?.order.status || vorige;
  await logboekSchrijf({
    orderId: o.id,
    orderNumber: o.orderNumber,
    actie: "betaalstatus",
    actor: opts.actor,
    notitie: `Bij Mollie opgehaald: ${payment.status}${vorige === nieuw ? " (geen wijziging)" : ` — status ${vorige} → ${nieuw}`}`,
    meta: { mollieStatus: payment.status, vorige, nieuw },
  });

  return { ok: true, mollieStatus: payment.status, vorigeStatus: vorige, status: nieuw, gewijzigd: vorige !== nieuw };
}

/* ────────────────────────────── annuleren ────────────────────────────── */

/**
 * Annuleer een onbetaalde bestelling: voorraad-hold, kortingscode en cadeaubon
 * gaan terug naar de pot en de order gaat op 'canceled'. Een betaalde
 * bestelling wordt geweigerd — die annuleer je door terug te betalen, anders
 * verdwijnt 'm uit de omzet terwijl het geld er nog staat.
 */
export async function orderAnnuleren(orderNumber: string, opts: ActieContext & { reden?: string } = {}): Promise<ActieResultaat> {
  const data = await getOrderByNumber(orderNumber);
  if (!data) return { ok: false, error: "Bestelling niet gevonden." };
  const o = data.order;
  if (BETAALD.includes(o.status)) {
    return { ok: false, error: "Deze bestelling is betaald. Betaal 'm eerst terug — annuleren zou het geld uit beeld halen." };
  }
  if (o.status === "canceled") return { ok: true, alGeannuleerd: true };

  await voidUnpaidOrder(o.id);
  await logboekSchrijf({
    orderId: o.id,
    orderNumber: o.orderNumber,
    actie: "geannuleerd",
    actor: opts.actor,
    notitie: String(opts.reden || "").trim() || "Handmatig geannuleerd",
    bedragCents: o.totalCents,
  });
  return { ok: true };
}

/* ─────────────────────── bevestigingsmail opnieuw ─────────────────────── */

/**
 * Stuur de orderbevestiging opnieuw. De verzending is idempotent gemaakt met
 * `confirmation_sent_at`; die zetten we hier bewust terug op leeg zodat de
 * bestaande, beproefde functie 'm opnieuw claimt en verstuurt. Alleen voor
 * betaalde bestellingen — vóór betaling bestaat er geen bevestiging.
 */
export async function bevestigingOpnieuw(orderNumber: string, opts: ActieContext = {}): Promise<ActieResultaat> {
  const data = await getOrderByNumber(orderNumber);
  if (!data) return { ok: false, error: "Bestelling niet gevonden." };
  const o = data.order;
  if (!BETAALD.includes(o.status)) return { ok: false, error: "De bevestiging gaat pas na betaling — deze bestelling is nog niet betaald." };
  const ref = String(o.molliePaymentId || "");
  if (!ref) return { ok: false, error: "Deze bestelling heeft geen betaalreferentie; de bevestiging kan niet opnieuw verstuurd worden." };

  const db = getDb();
  await db.update(orders).set({ confirmationSentAt: null }).where(eq(orders.id, o.id));
  try {
    await sendOrderConfirmationOnce(ref);
  } catch (e) {
    return { ok: false, error: `Versturen mislukte: ${(e as Error).message}` };
  }
  const [na] = await db.select({ verstuurd: orders.confirmationSentAt }).from(orders).where(eq(orders.id, o.id)).limit(1);
  if (!na?.verstuurd) {
    return { ok: false, error: "Er is niets verstuurd — staat de mailserver (RESEND_API_KEY) wel ingesteld?" };
  }

  await logboekSchrijf({
    orderId: o.id,
    orderNumber: o.orderNumber,
    actie: "bevestiging",
    actor: opts.actor,
    notitie: `Bevestiging opnieuw verstuurd naar ${o.email}`,
  });
  return { ok: true, email: o.email };
}

/* ─────────────────────── handmatige bestelling ─────────────────────── */

export type HandmatigeOrderInvoer = {
  contact: Partial<CheckoutContact>;
  items: CheckoutItem[];
  deliveryMethod?: string;
  pickupStore?: string;
  voucherCode?: string;
  /** Winkel die de bestelling maakt (omzet-attributie); leeg = webshop/HQ. */
  soldByStore?: string;
  /** "link" = Mollie-betaallink, "handmatig" = al betaald buiten Mollie om. */
  betaalwijze?: "link" | "handmatig";
  /** Betaallink meteen naar de klant mailen. */
  mail?: boolean;
  /** Toelichting bij een handmatig-betaald gemarkeerde bestelling (intern). */
  notitie?: string;
};

/** Bestaand klantaccount op e-mail — zodat de order in "Mijn bestellingen" en in
 *  het spaarsaldo van die klant terechtkomt in plaats van als gast te blijven. */
async function klantIdVoorEmail(email: string): Promise<string | null> {
  const norm = String(email || "").trim().toLowerCase();
  if (!norm) return null;
  try {
    const [c] = await getDb().select({ id: customers.id }).from(customers).where(eq(customers.email, norm)).limit(1);
    return c?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Maak handmatig een bestelling voor een klant (telefonisch, per mail, of een
 * nabestelling na een klacht) en zet er meteen een betaallink op.
 *
 * Loopt bewust door dezelfde `createOrder` als de webshop: prijzen komen uit de
 * database, voorraad wordt atomair geclaimd, verzendkosten en kortingscode
 * worden server-side berekend. Er is hier géén veld om zelf een bedrag te
 * typen — dat is precies hoe een orderbedrag gaat afwijken van wat er in de
 * catalogus staat en van wat de klant online zou betalen. Korting geef je met
 * een kortingscode (Site → Vouchers), dan staat 'ie ook in de rapportage.
 */
export async function maakHandmatigeOrder(invoer: HandmatigeOrderInvoer, opts: ActieContext = {}): Promise<ActieResultaat> {
  const c = (invoer?.contact ?? {}) as Record<string, string>;
  const items = Array.isArray(invoer?.items) ? invoer.items : [];
  if (!items.length) return { ok: false, error: "Voeg minstens één artikel toe." };
  if (!c.email || !/.+@.+\..+/.test(c.email)) return { ok: false, error: "Vul een geldig e-mailadres in." };
  if (!String(c.firstName || "").trim() || !String(c.lastName || "").trim()) return { ok: false, error: "Vul de voor- en achternaam van de klant in." };

  const isPickup = invoer.deliveryMethod === "pickup";
  const deliveryMethod: DeliveryMethod = isPickup ? "pickup" : invoer.deliveryMethod === "express" ? "express" : "standard";
  const pickupStore = String(invoer.pickupStore || "").trim();
  if (isPickup) {
    if (!pickupStore) return { ok: false, error: "Kies een afhaalwinkel." };
  } else {
    for (const f of ["street", "houseNumber", "postalCode", "city"]) {
      if (!String(c[f] || "").trim()) return { ok: false, error: "Vul het volledige bezorgadres in." };
    }
  }

  const customerId = await klantIdVoorEmail(c.email);

  let order;
  try {
    order = await createOrder(
      c as unknown as CheckoutContact,
      items,
      deliveryMethod,
      String(invoer.voucherCode || "").trim(),
      "", // cadeaubon: die verzilvert de klant zelf in de checkout, niet het back-office
      pickupStore,
      String(invoer.soldByStore || "").trim(),
      customerId,
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bestelling aanmaken mislukte." };
  }

  const origin = getSiteUrl();
  const confirmUrl = `${origin}/bestelling/${order.orderNumber}?t=${order.accessToken}`;
  const basis = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    actie: "aangemaakt" as const,
    actor: opts.actor,
    bedragCents: order.totalCents,
  };

  // Volledig gedekt (bv. door een 100%-kortingscode) → geen betaling nodig.
  if (order.totalCents === 0) {
    await finalizeGiftcardCoveredOrder(order.id).catch((e) =>
      console.error("[order-admin] afronden van een €0-bestelling mislukte:", order.orderNumber, e),
    );
    await logboekSchrijf({ ...basis, notitie: "Handmatig aangemaakt — € 0, geen betaling nodig" });
    return { ok: true, orderNumber: order.orderNumber, totalCents: 0, betaald: true, confirmUrl };
  }

  // Al betaald buiten Mollie om (bankoverschrijving, contant afgerekend).
  // Synthetische referentie `handmatig-…` houdt 'm herkenbaar én zorgt dat de
  // terugbetaalknop 'm niet als Mollie-betaling behandelt.
  if (invoer.betaalwijze === "handmatig") {
    const ref = `handmatig-${order.id}`;
    await attachMolliePayment(order.id, ref);
    await applyPaymentStatus(ref, "paid");
    await confirmAndPlan(ref).catch((e) =>
      console.error("[order-admin] bevestigen/inplannen na handmatige betaling mislukte:", order.orderNumber, e),
    );
    await logboekSchrijf({
      ...basis,
      notitie: `Handmatig aangemaakt en als betaald gemarkeerd${String(invoer.notitie || "").trim() ? ` — ${String(invoer.notitie).trim()}` : ""}`,
      meta: { betaalwijze: "handmatig" },
    });
    return { ok: true, orderNumber: order.orderNumber, totalCents: order.totalCents, betaald: true, confirmUrl };
  }

  if (!mollieConfigured()) {
    await logboekSchrijf({ ...basis, notitie: "Handmatig aangemaakt — Mollie niet geconfigureerd, geen betaallink" });
    return { ok: true, orderNumber: order.orderNumber, totalCents: order.totalCents, waarschuwing: "Mollie is niet geconfigureerd — er is geen betaallink gemaakt." };
  }

  await logboekSchrijf({ ...basis, notitie: "Handmatig aangemaakt in de portal" });
  // De betaallink loopt via dezelfde functie als "opnieuw sturen", zodat er maar
  // één plek is die een link maakt, mailt en logt.
  const link = await nieuweBetaallink(order.orderNumber, { actor: opts.actor, mail: invoer.mail });
  if (!link.ok) {
    return { ok: true, orderNumber: order.orderNumber, totalCents: order.totalCents, waarschuwing: `De bestelling staat er, maar de betaallink mislukte: ${link.error}` };
  }
  return {
    ok: true,
    orderNumber: order.orderNumber,
    totalCents: order.totalCents,
    checkoutUrl: link.checkoutUrl,
    gemaild: link.gemaild,
    confirmUrl,
    waarschuwing: link.waarschuwing,
  };
}

/* ─────────────────────── artikelzoeker voor de orderbouwer ─────────────────────── */

export type VariantHit = {
  sku: string;
  title: string;
  handle: string;
  size: string;
  color: string;
  priceCents: number;
  image: string;
  /** Online beschikbaar (webpool) — 'null' als het niet vast te stellen was. */
  online: number | null;
};

/**
 * Zoek varianten (maat-niveau) voor de orderbouwer: op titel, sku of barcode.
 * Bewust op VARIANT-niveau en niet op product: een bestelling gaat over "maat
 * 52 in donkerblauw", niet over "het colbert". De voorraad komt uit dezelfde
 * bron als de webshop, zodat een medewerker niet iets belooft wat er niet is.
 */
export async function zoekVarianten(q: string, limit = 20): Promise<VariantHit[]> {
  const term = String(q || "").trim();
  if (term.length < 2) return [];
  const max = Math.min(50, Math.max(1, limit));
  const qLower = term.toLowerCase();
  const like = `%${qLower.replace(/[%_]/g, "")}%`;
  const db = getDb();

  const rows = await db
    .select({
      sku: productVariants.sku,
      size: productVariants.size,
      color: productVariants.color,
      priceCents: productVariants.priceCents,
      handle: products.handle,
      title: products.title,
      image: productVariants.imageUrl,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(products.status, "active"),
        sql`(
          lower(coalesce(${productVariants.sku}, '')) like ${like}
          or lower(coalesce(${productVariants.barcode}, '')) like ${like}
          or lower(${products.title}) like ${like}
          or lower(coalesce(${productVariants.color}, '')) like ${like}
        )`,
      ),
    )
    .orderBy(products.title, productVariants.size)
    .limit(max);

  const skus = rows.map((r) => r.sku).filter(Boolean) as string[];
  let voorraad = new Map<string, { online: number }>();
  try {
    voorraad = (await availableForSkus(skus)) as unknown as Map<string, { online: number }>;
  } catch {
    // Voorraad onbekend is iets anders dan nul — dan tonen we geen getal.
  }
  return rows.map((r) => ({
    sku: r.sku || "",
    title: r.title || "",
    handle: r.handle || "",
    size: r.size || "",
    color: r.color || "",
    priceCents: Number(r.priceCents) || 0,
    image: r.image || "",
    online: voorraad.has(r.sku || "") ? Math.max(0, voorraad.get(r.sku || "")?.online ?? 0) : null,
  }));
}
