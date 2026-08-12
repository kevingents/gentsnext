"use client";

import { eventDef } from "@/lib/event-catalog";
import { readConsent } from "@/lib/consent";

/**
 * Brug van onze eigen events naar de Google-dataLayer (Tag Manager).
 *
 * Uitgangspunt: onze Neon-tabel blijft de bron van waarheid. GTM is een
 * DOORGEEFLUIK naar advertentieplatforms, geen tweede administratie. Daarom
 * vuurt elk event maar op één plek af (lib/track-client) en spiegelt dit
 * bestand het naar de dataLayer — je kunt dus nooit een event hebben dat wél in
 * GA4 staat en niet bij ons, of andersom.
 *
 * Twee dingen die hier bewust anders zijn dan in de meeste GTM-implementaties:
 *
 *  1. TOESTEMMING IS GELAAGD. Onze eigen meting vraagt analytics-toestemming.
 *     Advertentie-events vragen daarnaast marketing-toestemming. Een
 *     `add_to_cart` gaat dus wél de database in bij alleen analytics, maar niet
 *     de dataLayer uit. Tot nu toe werd de marketing-schakelaar in de
 *     cookiebanner alleen opgeslagen en nergens uitgelezen — er hing letterlijk
 *     niets aan.
 *  2. ECOMMERCE WORDT LEEGGEMAAKT. GA4 hergebruikt het `ecommerce`-object over
 *     pushes heen; zonder een `null`-push lekken items van het vorige event naar
 *     het volgende. Dat is de klassieke bron van "waarom staan er drie
 *     producten in mijn purchase die de klant nooit kocht".
 */

type DL = Record<string, unknown>;

declare global {
  interface Window {
    dataLayer?: DL[];
  }
}

export function pushDataLayer(obj: DL) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(obj);
}

type Item = {
  item_id?: string;
  item_name?: string;
  item_brand?: string;
  item_category?: string;
  item_variant?: string;
  price?: number;
  quantity?: number;
  index?: number;
};

/** Bouwt de GA4-items uit onze props, of maakt er één uit handle+bedrag. */
function itemsUit(props: Record<string, unknown>, handle: string, valueCents: number): Item[] {
  const raw = props.items;
  if (Array.isArray(raw) && raw.length) return raw as Item[];
  if (!handle) return [];
  const item: Item = { item_id: handle, item_name: String(props.title || handle) };
  if (props.brand) item.item_brand = String(props.brand);
  if (props.category) item.item_category = String(props.category);
  if (props.size || props.color) item.item_variant = [props.color, props.size].filter(Boolean).join(" / ");
  if (valueCents > 0) item.price = valueCents / 100;
  if (typeof props.position === "number") item.index = props.position;
  item.quantity = typeof props.qty === "number" ? props.qty : 1;
  return [item];
}

/**
 * Spiegel één intern event naar de dataLayer. Doet niets als het event geen
 * GA4-naam heeft (dan is het bewust alleen voor onszelf) of als de toestemming
 * ontbreekt.
 */
export function spiegelNaarDataLayer(
  type: string,
  props: Record<string, unknown>,
  extra: { path?: string; handle?: string; query?: string; valueCents?: number } = {}
) {
  const def = eventDef(type);
  if (!def?.ga4) return;

  const consent = readConsent();
  if (!consent?.analytics) return;
  if (def.marketing && !consent.marketing) return;

  const valueCents = Math.max(0, Math.round(Number(extra.valueCents) || 0));
  const payload: DL = { event: def.ga4, gents_event: type };

  if (extra.path) payload.page_path = extra.path;
  if (extra.query) payload.search_term = extra.query;
  for (const [k, v] of Object.entries(props)) {
    if (k === "items") continue;
    if (v === undefined || v === null || v === "") continue;
    payload[k] = v;
  }

  if (def.ecommerce) {
    // Eerst legen: GA4 hergebruikt dit object over pushes heen, dus zonder deze
    // regel sleept een vorig event zijn items mee naar het volgende.
    pushDataLayer({ ecommerce: null });
    const items = itemsUit(props, String(extra.handle || ""), valueCents);
    const ecommerce: DL = { currency: "EUR", items };
    if (valueCents > 0) ecommerce.value = valueCents / 100;
    if (props.orderNumber) ecommerce.transaction_id = String(props.orderNumber);
    if (props.listId) ecommerce.item_list_id = String(props.listId);
    if (props.listName) ecommerce.item_list_name = String(props.listName);
    if (props.coupon) ecommerce.coupon = String(props.coupon);
    if (props.shippingCents) ecommerce.shipping = Number(props.shippingCents) / 100;
    payload.ecommerce = ecommerce;
  } else if (valueCents > 0) {
    payload.value = valueCents / 100;
    payload.currency = "EUR";
  }

  pushDataLayer(payload);
}

/**
 * Google Consent Mode v2. Moet vóór elke tag draaien, met alles op `denied`:
 * dat is precies het punt van Consent Mode — Google mag pas iets, en modelleert
 * pas iets, ná een expliciete `update`. Stond hier tot nu toe helemaal niet,
 * waardoor elke tag die ooit geplaatst wordt standaard vol zou meten.
 */
export function zetConsentDefaults() {
  if (typeof window === "undefined") return;
  pushDataLayer({
    event: "consent_default",
    consent: {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
      functionality_storage: "granted",
      security_storage: "granted",
      wait_for_update: 500,
    },
  });
}

/* Het bijwerken ná een keuze staat bewust in lib/consent (pushConsentMode):
 * dáár wordt de keuze opgeslagen, en één schrijfmoment betekent dat de banner,
 * de footerlink en elk toekomstig instelscherm automatisch meegaan. */
