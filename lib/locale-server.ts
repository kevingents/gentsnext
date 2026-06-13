import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, PATH_HEADER, isLocale, type Locale } from "@/lib/i18n";

/**
 * Huidige locale (server components / route handlers). Fase 2: de middleware
 * zet de locale uit het URL-prefix in een request-header; die is leidend.
 * Valt terug op de cookie (browse-persistentie) en dan op de default (nl).
 */
export async function getLocale(): Promise<Locale> {
  try {
    const h = (await headers()).get(LOCALE_HEADER) || "";
    if (isLocale(h)) return h;
    const v = (await cookies()).get(LOCALE_COOKIE)?.value || "";
    return isLocale(v) ? v : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Het canonieke pad zonder locale-prefix (door de middleware gezet). */
export async function getCanonicalPath(): Promise<string> {
  try {
    return (await headers()).get(PATH_HEADER) || "/";
  } catch {
    return "/";
  }
}
