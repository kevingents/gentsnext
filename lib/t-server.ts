import type { Locale } from "@/lib/i18n";
import { t as tStatic, interpolate } from "@/lib/messages";
import { getUiMessages } from "@/lib/translate";

/**
 * Server-side vertaal-lookup voor SERVER COMPONENTS (pagina's). Anders dan `t()`
 * (die alleen de statische dicts + NL-fallback kent) leest deze óók de KV-store
 * met de cron-vertalingen (getUiMessages) — dezelfde bron die de client-provider
 * gebruikt. Zo tonen server-gerenderde koppen/eyebrows op /en /de /fr /es de
 * vertaalde tekst i.p.v. de hardcoded NL-bron.
 *
 * Volgorde: cron-store → statische dict → NL-catalogus → key zelf. Eén DB-lees
 * per request (gecachet in getTranslationStore); NL slaat de lees over.
 *
 * Gebruik:
 *   const locale = await getLocale();
 *   const t = await getT(locale);
 *   <h2>{t("home.new_inside")}</h2>
 */
export async function getT(locale: Locale): Promise<(key: string, params?: Record<string, string | number>) => string> {
  const overrides = await getUiMessages(locale).catch(() => undefined);
  return (key, params) => {
    const override = overrides?.[key];
    return override ? interpolate(override, params) : tStatic(key, locale, params);
  };
}
