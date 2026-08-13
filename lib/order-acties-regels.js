/**
 * lib/order-acties-regels.js — de HARDE regels onder de order-acties in de
 * portal (Site → Bestellingen): mag deze bestelling een nieuwe betaallink, en
 * hoeveel mag er van deze bestelling terug?
 *
 * Bewust een los JS-bestand zonder Next-imports zodat `node --test` erbij kan
 * (patroon van lib/ab-regels.js en lib/retour-instellingen.js). Dit is de grens
 * tussen een knop in het back-office en het geld van de klant, dus hier hoort
 * een test onder — niet in een route die alleen live te proberen is.
 *
 * De drie regels die er echt toe doen:
 *
 *  1. EEN BETAALDE BESTELLING KRIJGT NOOIT EEN NIEUWE BETAALLINK. Klinkt
 *     vanzelfsprekend, maar de statussen liggen ver uit elkaar: 'paid' is niet
 *     de enige betaalde toestand — 'shipped', 'ready_pickup' en 'delivered'
 *     zijn dat óók. Een link op een verzonden order = de klant betaalt twee keer.
 *
 *  2. EEN MISLUKTE BESTELLING MÉT CADEAUBON KRIJGT GEEN NIEUWE LINK. Bij
 *     'failed'/'expired'/'canceled' geeft de webhook het bonsaldo terug aan de
 *     klant (releaseOrderGiftcard). Het ordertotaal is dan al verlaagd met dat
 *     bedrag, en opnieuw afboeken kan niet: redeemGiftcard is idempotent op
 *     (bon, ordernummer) — een tweede poging op hetzelfde ordernummer meldt
 *     "gelukt" zonder ook maar iets af te schrijven. De klant zou het bonsaldo
 *     houden én de korting krijgen. Vandaar: weigeren, en een nieuwe
 *     bestelling maken.
 *
 *  3. TERUGBETALEN KAN NOOIT MEER DAN ER GEÏND IS. De bovengrens komt van
 *     Mollie zelf (amountRemaining), niet uit onze eigen kolommen — Mollie weet
 *     wat er al terugging, wij niet. Zonder Mollie-gegevens is het antwoord 0,
 *     niet "dan maar het ordertotaal".
 */

/** Statussen waarin het geld binnen is — een nieuwe betaallink is dan fout. */
export const BETAALDE_STATUSSEN = ["paid", "shipped", "ready_pickup", "delivered"];

/** Statussen waarin de vorige poging is TERUGGEDRAAID (voorraad-hold, voucher
 *  en cadeaubon zijn vrijgegeven). Een nieuwe link moet die claims herstellen. */
export const TERUGGEDRAAIDE_STATUSSEN = ["failed", "expired", "canceled"];

/** Betaalreferenties die geen échte Mollie-betaling zijn (geen geldstroom bij
 *  Mollie, dus ook niets om via Mollie terug te betalen). */
const SYNTHETISCHE_PREFIXEN = ["gift-", "register-", "handmatig-"];

/** @param {string | null | undefined} ref */
export function isSynthetischeBetaalref(ref) {
  const s = String(ref || "");
  return SYNTHETISCHE_PREFIXEN.some((p) => s.startsWith(p));
}

/**
 * Mag deze bestelling een (nieuwe) betaallink?
 *
 * @param {{status?: string, totalCents?: number, giftcardCode?: string, giftcardCents?: number}} order
 * @returns {{ok: boolean, error?: string, herstelNodig: boolean}}
 *   `herstelNodig` = de vorige poging is teruggedraaid, dus voorraad + voucher
 *   moeten opnieuw geclaimd worden vóór de link verstuurd wordt.
 */
export function magNieuweBetaallink(order) {
  const status = String(order?.status || "");
  const totaal = Number(order?.totalCents) || 0;
  const herstelNodig = TERUGGEDRAAIDE_STATUSSEN.includes(status);

  if (BETAALDE_STATUSSEN.includes(status)) {
    return { ok: false, error: "Deze bestelling is al betaald — een nieuwe betaallink zou dubbel incasseren.", herstelNodig };
  }
  if (status === "refunded") {
    return { ok: false, error: "Deze bestelling is terugbetaald. Maak een nieuwe bestelling.", herstelNodig };
  }
  if (totaal <= 0) {
    return { ok: false, error: "Er staat niets open (€ 0) — deze bestelling hoeft niet betaald te worden.", herstelNodig };
  }
  if (herstelNodig && String(order?.giftcardCode || "") && (Number(order?.giftcardCents) || 0) > 0) {
    return {
      ok: false,
      error:
        "Op deze bestelling stond een cadeaubon. Die is bij de mislukte betaling teruggeboekt naar de klant en kan niet nog eens voor ditzelfde ordernummer worden afgeschreven — maak een nieuwe bestelling.",
      herstelNodig,
    };
  }
  return { ok: true, herstelNodig };
}

/**
 * Hoeveel mag er van deze bestelling terug via Mollie?
 *
 * @param {{molliePaymentId?: string | null, totalCents?: number}} order
 * @param {{amountCents?: number, refundedCents?: number, remainingCents?: number|null, status?: string} | null} betaling
 *        Momentopname van de Mollie-betaling (lib/mollie getMolliePayment).
 * @returns {{maxCents: number, reden?: string}}
 */
export function terugbetaalRuimte(order, betaling) {
  const ref = String(order?.molliePaymentId || "");
  if (!ref) return { maxCents: 0, reden: "Deze bestelling heeft geen betaling — er is niets om terug te storten." };
  if (isSynthetischeBetaalref(ref)) {
    return {
      maxCents: 0,
      reden: "Deze bestelling is niet via Mollie betaald (cadeaubon, kassa of handmatig). Terugbetalen doe je op dezelfde manier als er betaald is.",
    };
  }
  if (!betaling) return { maxCents: 0, reden: "De betaalstatus kon niet bij Mollie worden opgehaald — probeer het zo nog eens." };
  if (!["paid", "authorized"].includes(String(betaling.status || ""))) {
    return { maxCents: 0, reden: `De betaling staat bij Mollie op "${betaling.status || "onbekend"}" — daar valt niets van terug te storten.` };
  }
  // Mollie's eigen restant is leidend. Ontbreekt het veld (oudere betaling,
  // methode zonder refunds), dan rekenen we het zelf uit: geïnd − al terug.
  const geind = Math.max(0, Math.round(Number(betaling.amountCents) || 0));
  const alTerug = Math.max(0, Math.round(Number(betaling.refundedCents) || 0));
  const restant =
    betaling.remainingCents === null || betaling.remainingCents === undefined
      ? geind - alTerug
      : Math.max(0, Math.round(Number(betaling.remainingCents) || 0));
  const maxCents = Math.max(0, Math.min(restant, geind - alTerug));
  if (maxCents <= 0) {
    return { maxCents: 0, reden: alTerug > 0 ? "Deze betaling is al volledig terugbetaald." : "Er is niets terug te betalen op deze betaling." };
  }
  return { maxCents };
}

/**
 * Klemt een ingetypt bedrag op iets dat we durven terug te storten: hele centen,
 * nooit negatief, nooit boven het restant. Een leeg/onleesbaar veld is 0 (de
 * aanroeper weigert dat), NIET "dan maar alles".
 *
 * @param {unknown} invoer bedrag in centen
 * @param {number} maxCents
 */
export function schoonRefundBedrag(invoer, maxCents) {
  const max = Math.max(0, Math.floor(Number(maxCents) || 0));
  const n = Math.floor(Number(invoer));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, max);
}

/**
 * Idempotency-sleutel voor een terugbetaling. Mollie kapt de sleutel af op 40
 * tekens: `refund-<uuid>-<bedrag>` wordt daardoor voor élk bedrag dezelfde
 * sleutel, en dan levert een tweede (bedoelde) deel-terugbetaling stilletjes de
 * eerste refund opnieuw op — de klant krijgt zijn tweede bedrag nooit. Vandaar
 * kort: order-prefix + bedrag + minuutstempel. Twee klikken binnen dezelfde
 * minuut op hetzelfde bedrag = één terugstorting (bedoeld); een échte tweede
 * terugbetaling van hetzelfde bedrag een minuut later gaat gewoon door.
 *
 * @param {string} orderId
 * @param {number} bedragCents
 * @param {number} nuMs
 */
export function refundSleutel(orderId, bedragCents, nuMs) {
  const kort = String(orderId || "").replace(/-/g, "").slice(0, 10);
  const minuut = Math.floor((Number(nuMs) || 0) / 60000).toString(36);
  return `rf-${kort}-${Math.max(0, Math.floor(Number(bedragCents) || 0))}-${minuut}`.slice(0, 40);
}

/**
 * Idempotency-sleutel voor een nieuwe betaallink. Zelfde reden als hierboven:
 * kort houden, en per minuut vernieuwen zodat dubbelklikken één betaling geeft
 * maar een bewuste tweede link (later) een nieuwe.
 *
 * @param {string} orderId
 * @param {number} nuMs
 */
export function betaallinkSleutel(orderId, nuMs) {
  const kort = String(orderId || "").replace(/-/g, "").slice(0, 12);
  const minuut = Math.floor((Number(nuMs) || 0) / 60000).toString(36);
  return `pl-${kort}-${minuut}`.slice(0, 40);
}
