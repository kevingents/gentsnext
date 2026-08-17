/**
 * Betaalkeuze op de afrekenpagina.
 *
 * De klant kreeg alle actieve Mollie-methoden als gelijkwaardig raster te zien —
 * acht knoppen waarvan er in Nederland maar één of twee toe doen. Nu staat er per
 * land een korte kopgroep (standaard iDEAL · Klarna · Card) en valt de rest onder
 * één regel "Overige betaalmethoden": die stuurt de klant zónder vooraf gekozen
 * methode naar Mollie, dat dan zijn eigen scherm met álles toont. Zo blijft elke
 * methode bereikbaar zonder de keuze te verwateren.
 *
 * De kopgroep is per land instelbaar in de tool (portal → Instellingen), niet in
 * code of env: welke methode bovenaan hoort is een commerciële keuze die per
 * markt en per seizoen verschuift.
 *
 * Een A/B op die volgorde loopt NIET hier maar over de bestaande experimenten-
 * rail (lib/experiments): een variant zet de override `betaalmethoden`. Zo tellen
 * bucket, land-targeting, exposure-meting, SRM-waakhond en de winnaar-doorvoeren-
 * knop precies zoals bij elke andere proef, in plaats van een tweede A/B-mechaniek
 * ernaast.
 */

/**
 * Mollie-method-id's die wij kennen. Eén lijst, want zowel de checkout (welke id
 * mag naar Mollie mee) als de instellingen (welke id mag je invoeren) moeten
 * hetzelfde vinden — anders stel je iets in dat bij het afrekenen stil wegvalt.
 */
export const MOLLIE_METHOD_IDS = [
  "ideal", "creditcard", "paypal", "bancontact", "banktransfer", "kbc", "belfius",
  "eps", "przelewy24", "applepay", "googlepay", "giftcard", "in3", "klarna", "billie",
  "klarnapaylater", "klarnasliceit", "paysafecard", "sofort", "trustly",
] as const;

export type PaymentTopConfig = {
  /** Landcode (ISO-2, hoofdletters) → geordende Mollie-method-id's. "*" = alle overige landen. */
  topByCountry: Record<string, string[]>;
  /** Hoeveel methoden maximaal als knop; wat overblijft zit achter "overige". */
  maxVisible: number;
};

/** Wat de afrekenpagina van /api/payment-methods terugkrijgt. */
export type PaymentChoice = {
  methods: { id: string; description: string; image: string }[];
  /** De kopgroep voor dít land, al met een eventuele experiment-override erin. */
  top: string[];
  maxVisible: number;
  /** Toewijzingen om exposure voor te loggen (geforceerde previews zitten er niet in). */
  ab: { id: string; variant: string }[];
};

/**
 * Startpunt. Nederland/rest van de wereld: iDEAL, Klarna, Card. België krijgt
 * Bancontact vooraan — daar is dat de standaard-betaalknop. Allemaal in de tool
 * te wijzigen; dit is alleen wat er staat zolang niemand iets ingesteld heeft.
 */
export const DEFAULT_PAYMENT_TOP: PaymentTopConfig = {
  topByCountry: {
    "*": ["ideal", "klarna", "creditcard"],
    BE: ["bancontact", "ideal", "creditcard"],
  },
  maxVisible: 3,
};

const norm = (c: string) => String(c || "").trim().toUpperCase();

/** De gewenste kopgroep voor dit land, als geordende method-id's. */
export function topFor(cfg: PaymentTopConfig, country: string): string[] {
  const c = norm(country);
  return cfg.topByCountry[c] ?? cfg.topByCountry["*"] ?? [];
}

/**
 * Verdeelt de door Mollie teruggegeven methoden over de knoppen bovenaan en de
 * rest. Een geconfigureerde methode die Mollie voor dit bedrag/land NIET aanbiedt
 * slaan we over in plaats van 'm als dode knop te tonen; is de hele kopgroep
 * onbeschikbaar, dan vullen we aan met de eerste beschikbare methoden zodat er
 * nooit een leeg blok staat.
 */
export function splitMethods<T extends { id: string }>(
  available: T[],
  top: string[],
  maxVisible: number,
): { visible: T[]; rest: T[] } {
  const byId = new Map(available.map((m) => [m.id, m]));
  const limit = Math.max(1, Math.round(maxVisible) || 3);
  const visible: T[] = [];
  for (const id of top) {
    const m = byId.get(id);
    if (m && !visible.includes(m)) visible.push(m);
    if (visible.length >= limit) break;
  }
  for (const m of available) {
    if (visible.length >= limit) break;
    if (!visible.includes(m)) visible.push(m);
  }
  const rest = available.filter((m) => !visible.includes(m));
  return { visible, rest };
}
