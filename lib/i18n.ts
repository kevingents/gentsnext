/**
 * Meertaligheid — fase 1: locale via cookie (geen route-prefix, dus géén risico
 * voor bestaande routes). Default Nederlands; ontbrekende vertalingen vallen
 * netjes terug op NL. Fase 2 (later) voegt locale-URL's + hreflang toe voor SEO.
 *
 * Dit bestand is CLIENT-veilig (geen next/headers). De server-getter
 * getLocale() staat in lib/locale-server.
 */

export const LOCALES = ["nl", "en", "de", "fr", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "nl";

export const LOCALE_LABELS: Record<Locale, string> = {
  nl: "Nederlands",
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
};

export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}

export const LOCALE_COOKIE = "gents-locale";

// Fase 2: locale-URL's. Default (nl) blijft prefix-loos zodat bestaande
// Nederlandse URL's en SEO ongemoeid blijven; andere talen krijgen /<loc>/…
export const LOCALE_HEADER = "x-gents-locale"; // door middleware gezet
export const PATH_HEADER = "x-gents-path"; // canoniek pad zonder locale-prefix

/** hreflang-codes per locale (voor <link rel="alternate">). */
export const HREFLANG: Record<Locale, string> = {
  nl: "nl-NL",
  en: "en",
  de: "de",
  fr: "fr",
  es: "es",
};

/** URL-prefix voor een locale ('' voor nl). */
export function localePrefix(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "" : `/${locale}`;
}

/** Splitst een eventueel leidend locale-segment van een pad af. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const seg = pathname.split("/")[1] || "";
  if (isLocale(seg) && seg !== DEFAULT_LOCALE) {
    const rest = pathname.slice(seg.length + 1);
    return { locale: seg, path: rest.startsWith("/") ? rest : `/${rest}` };
  }
  return { locale: DEFAULT_LOCALE, path: pathname || "/" };
}

/** Voegt het juiste locale-prefix toe aan een (prefix-loos) pad. */
export function localizedPath(path: string, locale: Locale): string {
  const p = localePrefix(locale) + (path === "/" ? "" : path);
  return p || "/";
}
