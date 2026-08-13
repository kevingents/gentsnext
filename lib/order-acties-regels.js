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

/* ────────────────────────── adres wijzigen ────────────────────────── */

/** Adresvelden die het back-office mag bijwerken. */
export const ADRESVELDEN = [
  "firstName", "lastName", "phone", "email",
  "street", "houseNumber", "postalCode", "city", "country",
  "companyName", "vatNumber",
];

/** Velden die niet leeg mogen worden gemaakt op een bezorgorder. */
const VERPLICHT_BIJ_BEZORGEN = ["firstName", "lastName", "email", "street", "houseNumber", "postalCode", "city"];

/**
 * Mag het adres van deze bestelling nog gewijzigd worden?
 *
 * @param {{status?: string, deliveryMethod?: string}} order
 * @param {number} picks aantal winkeldelen dat al gepickt is (order_shipment_picks)
 * @returns {{ok: boolean, error?: string, landVast: boolean, waarschuwing?: string}}
 *   `landVast` = het land ligt vast omdat de verzendkosten al betaald zijn.
 */
export function magAdresWijzigen(order, picks = 0) {
  const status = String(order?.status || "");
  const landVast = BETAALDE_STATUSSEN.includes(status);

  if (status === "shipped" || status === "delivered") {
    return {
      ok: false,
      landVast,
      error: "Het pakket is al onderweg — een adreswijziging hier verandert daar niets meer aan. Regel het met de vervoerder of stuur de klant een retourlabel.",
    };
  }
  if (status === "refunded") {
    return { ok: false, landVast, error: "Deze bestelling is terugbetaald en wordt niet meer verstuurd." };
  }
  if (status === "canceled") {
    return { ok: false, landVast, error: "Deze bestelling is geannuleerd." };
  }
  // Gepickt maar nog niet verzonden: het verzendlabel kan al gedrukt zijn met
  // het oude adres. Wijzigen mag — soms moet het juist — maar niet stilletjes.
  if (picks > 0) {
    return {
      ok: true,
      landVast,
      waarschuwing: "Deze bestelling is al (deels) gepickt. Er kan al een verzendlabel met het oude adres liggen — controleer dat in de winkel vóór het pakket weggaat.",
    };
  }
  return { ok: true, landVast };
}

/** "1234ab" → "1234 AB"; laat een buitenlandse postcode met rust. */
function schoonPostcode(waarde, land) {
  const s = String(waarde || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (String(land || "NL").toUpperCase() !== "NL") return s;
  const m = /^(\d{4})\s?([A-Z]{2})$/.exec(s.replace(/\s+/g, ""));
  return m ? `${m[1]} ${m[2]}` : s;
}

/**
 * Maak een ingevuld adresformulier schoon tegen de HUIDIGE order.
 *
 * De belangrijkste regel: een veld dat niet is meegestuurd, of dat leeg is
 * teruggekomen, laat de bestaande waarde staan. Een half ingevuld formulier —
 * of een formulier waarin iemand per ongeluk een veld leegde — mag nooit stil
 * het bezorgadres van een order slopen. Dat is dezelfde afspraak als bij de
 * retour-instellingen (lib/retour-instellingen).
 *
 * Het LAND is apart: dat bepaalt de verzendkosten, die bij een betaalde order al
 * geïnd zijn. `landVast` houdt het dan op de oude waarde in plaats van stil een
 * ander tarief te impliceren.
 *
 * @param {Record<string, unknown>} invoer
 * @param {Record<string, string>} huidig de order zoals 'ie nu in de database staat
 * @param {{landVast?: boolean, bezorgen?: boolean}} opts
 * @returns {{waarden: Record<string,string>, gewijzigd: string[], fouten: string[], landGeweigerd: boolean}}
 */
export function schoonAdres(invoer, huidig, opts = {}) {
  const waarden = {};
  const gewijzigd = [];
  const fouten = [];
  let landGeweigerd = false;
  const bezorgen = opts.bezorgen !== false;

  for (const veld of ADRESVELDEN) {
    const oud = String(huidig?.[veld] ?? "").trim();
    const ruw = invoer?.[veld];
    let nieuw = ruw === undefined || ruw === null ? oud : String(ruw).trim();

    // Leeg ingestuurd op een verplicht veld → oude waarde behouden.
    if (!nieuw && (VERPLICHT_BIJ_BEZORGEN.includes(veld) ? bezorgen : false)) nieuw = oud;

    if (veld === "email" && nieuw && !/.+@.+\..+/.test(nieuw)) {
      fouten.push("Het e-mailadres klopt niet.");
      nieuw = oud;
    }
    if (veld === "country") {
      nieuw = (nieuw || oud || "NL").toUpperCase().slice(0, 2);
      if (opts.landVast && nieuw !== oud) {
        landGeweigerd = true;
        nieuw = oud;
      }
    }
    if (veld === "email") nieuw = nieuw.toLowerCase();
    waarden[veld] = nieuw.slice(0, 200);
  }

  waarden.postalCode = schoonPostcode(waarden.postalCode, waarden.country);
  for (const veld of ADRESVELDEN) {
    if (waarden[veld] !== String(huidig?.[veld] ?? "").trim()) gewijzigd.push(veld);
  }
  return { waarden, gewijzigd, fouten, landGeweigerd };
}

/**
 * Mag de order-route (allocatie naar filialen) opnieuw berekend worden?
 * Alleen zinvol op een betaalde bezorgorder waar nog niets gepickt is: zodra een
 * winkel z'n deel heeft gepakt, zou een nieuw plan de winkelvloer tegenspreken.
 *
 * @param {{status?: string, deliveryMethod?: string, molliePaymentId?: string|null}} order
 * @param {number} picks
 */
export function magRouteOpnieuw(order, picks = 0) {
  const status = String(order?.status || "");
  if (!BETAALDE_STATUSSEN.includes(status)) {
    return { ok: false, error: "De route wordt pas berekend zodra de bestelling betaald is." };
  }
  if (status === "shipped" || status === "delivered") {
    return { ok: false, error: "Deze bestelling is al verzonden." };
  }
  if (String(order?.deliveryMethod || "") === "pickup") {
    return { ok: false, error: "Een afhaalbestelling heeft geen route — die ligt klaar in de gekozen winkel." };
  }
  if (picks > 0) {
    return { ok: false, error: "Er is al gepickt voor deze bestelling. Een nieuwe route zou de winkel tegenspreken." };
  }
  if (!String(order?.molliePaymentId || "")) {
    return { ok: false, error: "Deze bestelling heeft geen betaalreferentie; de route kan niet opnieuw berekend worden." };
  }
  return { ok: true };
}
