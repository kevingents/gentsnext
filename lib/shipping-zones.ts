/**
 * Bezorglanden + DHL-tarieven. De bezorgpagina beloofde al jaren de volledige
 * DHL-staffel (NL/BE € 3,95, DE € 4,95 vanaf € 100 gratis, overig Europa
 * € 12,95), terwijl de checkout één vast tarief rekende en alléén Nederland
 * accepteerde. Dit bestand is de gedeelde bron: server (createOrder) én
 * checkout-UI rekenen met dezelfde tabel, en de bedragen komen uit de
 * instelbare settings-store (niet uit env/hardcoded teksten).
 *
 * Postcode-patroon per land: de checkout valideerde altijd op het Nederlandse
 * formaat (1234 AB), wat Belgische/Duitse adressen zou weigeren.
 */

export type ShippingZone = {
  /** ISO-landcode; gaat mee naar de order + allocatie. */
  code: string;
  /** Nederlandse landnaam (UI-label; via de vertaalrail vertaalbaar). */
  label: string;
  /** Verzendkosten in centen. */
  rateCents: number;
  /** Gratis vanaf dit bedrag (null = nooit gratis). */
  freeFromCents: number | null;
  /** Postcode-validatie voor dit land. */
  postcode: RegExp;
  /** Voorbeeld voor het invoerveld. */
  postcodeExample: string;
  /**
   * Aan = klanten uit dit land kunnen afrekenen. Staat voor alles behalve NL
   * UIT: de keten erachter is er nog niet klaar voor (ketencheck 24 juli) —
   * geen internationaal verzendlabel/track&trace, geen btw/OSS-afhandeling,
   * retourportaal + retourlabel zijn NL(/BE-winkel)-only, en de bezorgbelofte
   * ("morgen in huis") kent geen landtransit. Zodra dat geregeld is: hier op
   * true zetten — de tarieven kloppen al.
   */
  enabled: boolean;
};

/** DHL-staffel zoals op de bezorgpagina (bron: Kevin, 24 juli 2026). */
export const SHIPPING_ZONES: ShippingZone[] = [
  { code: "NL", label: "Nederland", rateCents: 395, freeFromCents: 7500, postcode: /^[1-9][0-9]{3}\s?[a-zA-Z]{2}$/, postcodeExample: "1234 AB" , enabled: true },
  { code: "BE", label: "België", rateCents: 395, freeFromCents: 7500, postcode: /^[1-9][0-9]{3}$/, postcodeExample: "2000" , enabled: false },
  { code: "DE", label: "Duitsland", rateCents: 495, freeFromCents: 10000, postcode: /^[0-9]{5}$/, postcodeExample: "10115" , enabled: false },
  { code: "AT", label: "Oostenrijk", rateCents: 1295, freeFromCents: null, postcode: /^[0-9]{4}$/, postcodeExample: "1010" , enabled: false },
  { code: "FR", label: "Frankrijk", rateCents: 1295, freeFromCents: null, postcode: /^[0-9]{5}$/, postcodeExample: "75001" , enabled: false },
  { code: "LU", label: "Luxemburg", rateCents: 1295, freeFromCents: null, postcode: /^[0-9]{4}$/, postcodeExample: "1009" , enabled: false },
  { code: "ES", label: "Spanje", rateCents: 1295, freeFromCents: null, postcode: /^[0-9]{5}$/, postcodeExample: "28001" , enabled: false },
  { code: "IT", label: "Italië", rateCents: 1295, freeFromCents: null, postcode: /^[0-9]{5}$/, postcodeExample: "00184" , enabled: false },
];

export const DEFAULT_COUNTRY = "NL";

export function zoneFor(code: string): ShippingZone {
  const c = String(code || "").trim().toUpperCase();
  return SHIPPING_ZONES.find((z) => z.code === c) ?? SHIPPING_ZONES[0];
}

/** Landen waar de klant nu écht kan bestellen (UI-lijst). */
export function enabledZones(): ShippingZone[] {
  return SHIPPING_ZONES.filter((z) => z.enabled);
}

/** Bezorgen we hier? Onbekend óf uitgezet land → nee (fail-closed). */
export function isKnownCountry(code: string): boolean {
  const c = String(code || "").trim().toUpperCase();
  return SHIPPING_ZONES.some((z) => z.code === c && z.enabled);
}

/**
 * Verzendkosten voor één land bij dit subtotaal. `nlOverride` laat de bestaande
 * settings-knoppen (freeShippingCents/shippingCents, instelbaar in de tool) het
 * Nederlandse tarief blijven bepalen — zo blijft één plek de baas over NL.
 */
export function shippingCentsFor(
  countryCode: string,
  subtotalCents: number,
  nlOverride?: { rateCents: number; freeFromCents: number },
): number {
  const zone = zoneFor(countryCode);
  const rate = zone.code === DEFAULT_COUNTRY && nlOverride ? nlOverride.rateCents : zone.rateCents;
  const freeFrom = zone.code === DEFAULT_COUNTRY && nlOverride ? nlOverride.freeFromCents : zone.freeFromCents;
  if (subtotalCents <= 0) return 0;
  if (freeFrom !== null && subtotalCents >= freeFrom) return 0;
  return rate;
}
