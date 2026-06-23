import "@/lib/load-env";
import { isLocale } from "@/lib/i18n";
import { ensureCatalogTranslations, LANG_NAME } from "@/lib/translate";

/**
 * AI-vertaling van de catalogus naar een doeltaal (idempotent/delta). Titels
 * altijd; voeg --descriptions toe voor omschrijvingen + SEO (duurder).
 * Provider: Claude (ANTHROPIC_API_KEY) of OpenAI (OPENAI_API_KEY).
 *   npm run translate:catalog -- en                 (alleen titels)
 *   npm run translate:catalog -- de --descriptions  (titels + omschrijvingen)
 *
 * Voor een eerste volledige backfill: draai dit per taal. Daarna houdt de
 * nachtelijke cron (/api/cron/translate) nieuwe/gewijzigde content bij.
 */
async function main() {
  const locale = (process.argv[2] || "en").trim();
  const descriptions = process.argv.includes("--descriptions");
  if (!isLocale(locale) || locale === "nl") {
    console.error("Gebruik: npm run translate:catalog -- <en|de|fr|es> [--descriptions]");
    process.exit(1);
  }
  console.log(`⏳ Catalogus vertalen naar ${LANG_NAME[locale]}${descriptions ? " (incl. omschrijvingen)" : ""}…`);
  const { translated } = await ensureCatalogTranslations(locale, { descriptions, limit: 5000 });
  console.log(`✓ Klaar — ${translated} producten vertaald naar ${locale}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
