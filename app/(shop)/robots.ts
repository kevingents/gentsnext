import type { MetadataRoute } from "next";

/**
 * Tot de cutover blijft de hele site dicht voor crawlers. Pas bij livegang
 * wordt SITE_INDEXABLE=true gezet (zie launch-checklist in README) — het
 * klassieke replatform-ongeluk is een staging-noindex die mee naar productie
 * gaat, hier is dat een bewuste, zichtbare schakelaar.
 */
export default function robots(): MetadataRoute.Robots {
  if (process.env.SITE_INDEXABLE === "true") {
    return { rules: { userAgent: "*", allow: "/" } };
  }
  return { rules: { userAgent: "*", disallow: "/" } };
}
