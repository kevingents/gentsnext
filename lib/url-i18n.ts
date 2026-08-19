import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { vertaalPad, ontvertaalPad, publiekPad, URL_LOCALES, URL_DEFAULT_LOCALE } from "@/lib/url-i18n-regels";

/**
 * Getypeerde schil om lib/url-i18n-regels.js. De regels staan in plain JS zodat
 * `node --test` ze zonder bouwstap kan draaien (test/url-i18n.test.js); hier
 * staat alleen de typing en de koppeling aan het Locale-type.
 */

// Waakhond: de regels dupliceren de localelijst (ze mogen lib/i18n.ts niet
// importeren — dat is TypeScript). Loopt die uit de pas, dan vertaalt een taal
// stilzwijgend niet meer. Dit faalt bij het typechecken, niet pas in productie.
const _localesGelijk: readonly Locale[] = URL_LOCALES as readonly Locale[];
void _localesGelijk;
if (URL_DEFAULT_LOCALE !== DEFAULT_LOCALE) {
  throw new Error(`url-i18n-regels: default-locale ${URL_DEFAULT_LOCALE} ≠ ${DEFAULT_LOCALE}`);
}

/** Nederlands pad (prefix-loos) → gelokaliseerd pad (prefix-loos). */
export function translatePath(nlPath: string, locale: Locale): string {
  return vertaalPad(nlPath, locale);
}

/** Gelokaliseerd pad (prefix-loos) → Nederlands pad, voor de middleware-rewrite. */
export function untranslatePath(locPath: string, locale: Locale): string {
  return ontvertaalPad(locPath, locale);
}

/** Volledig publiek pad inclusief locale-prefix. NL-pad in, publieke URL uit. */
export function localizedUrlPath(nlPath: string, locale: Locale): string {
  return publiekPad(nlPath, locale);
}

/**
 * Van een BINNENGEKOMEN (gelokaliseerd) pad naar het publieke pad in een andere
 * taal — voor de taalwisselaar. Eerst terug naar Nederlands, dan heen: anders
 * zou /en/category/suits in het Duits /de/category/suits worden.
 */
export function switchLocalePath(incomingPath: string, from: Locale, to: Locale): string {
  return publiekPad(ontvertaalPad(incomingPath, from), to);
}
