import type { Metadata } from "next";
import { getLocale } from "@/lib/locale-server";
import { LOCALES, HREFLANG, localePrefix } from "@/lib/i18n";

/**
 * Locale-bewuste canonical + hreflang-alternates voor één (prefix-loos) pad.
 * De pagina geeft haar Nederlandse pad door (bv. "/products/colbert"); deze
 * helper maakt er de juiste canonical van voor de huidige taal en somt alle
 * taalvarianten op voor Google. metadataBase maakt ze absoluut.
 */
export async function localeAlternates(path: string): Promise<NonNullable<Metadata["alternates"]>> {
  const locale = await getLocale();
  const languages: Record<string, string> = {};
  for (const l of LOCALES) languages[HREFLANG[l]] = (localePrefix(l) + (path === "/" ? "" : path)) || "/";
  languages["x-default"] = path || "/";
  return {
    canonical: (localePrefix(locale) + (path === "/" ? "" : path)) || "/",
    languages,
  };
}
