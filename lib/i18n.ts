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
