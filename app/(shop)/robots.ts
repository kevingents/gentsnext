import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Tot de cutover blijft de hele site dicht voor crawlers. Pas bij livegang
 * wordt SITE_INDEXABLE=true gezet (zie launch-checklist in README) — het
 * klassieke replatform-ongeluk is een staging-noindex die mee naar productie
 * gaat, hier is dat een bewuste, zichtbare schakelaar.
 */
export default function robots(): MetadataRoute.Robots {
  if (process.env.SITE_INDEXABLE === "true") {
    return {
      // Crawl toestaan, maar transactionele/persoonlijke/API-paden uitsluiten
      // (geen crawlbudget-verspilling of thin-content-indexatie), + sitemap-hint.
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/account", "/afrekenen", "/winkelwagen", "/favorieten", "/punten-claim", "/api/", "/zoeken"],
      },
      sitemap: `${getSiteUrl()}/sitemap.xml`,
    };
  }
  return { rules: { userAgent: "*", disallow: "/" } };
}
