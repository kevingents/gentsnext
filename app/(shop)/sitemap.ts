import type { MetadataRoute } from "next";
import { listCollections, listProductHandles } from "@/lib/catalog";
import { getSiteUrl } from "@/lib/site-url";

export const revalidate = 3600;

/**
 * Sitemap uit de eigen catalogus — vervangt Shopify's automatische sitemap.
 * Faalt stil naar een minimale variant wanneer de database (nog) niet
 * bereikbaar is, zodat een build zonder DATABASE_URL niet breekt.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const base: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/collections`, changeFrequency: "weekly", priority: 0.6 },
  ];

  try {
    const [collections, productHandles] = await Promise.all([
      listCollections(),
      listProductHandles(),
    ]);
    return [
      ...base,
      ...collections.map((c) => ({
        url: `${siteUrl}/collections/${c.handle}`,
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
      ...productHandles.map((p) => ({
        url: `${siteUrl}/products/${p.handle}`,
        lastModified: p.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
    ];
  } catch {
    return base;
  }
}
