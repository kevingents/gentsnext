import type { MetadataRoute } from "next";
import { listCollections, listProductHandles } from "@/lib/catalog";
import { getSiteUrl } from "@/lib/site-url";
import { SIZE_GUIDES } from "@/lib/size-chart-hub";
import { CATEGORIES } from "@/lib/categories";
import { BRANDS } from "@/lib/brands";
import { getBlogPosts } from "@/lib/blog";
import { getAllLooks } from "@/lib/looks";

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
    { url: `${siteUrl}/blog`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${siteUrl}/looks`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${siteUrl}/gelegenheden`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${siteUrl}/maatadvies`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${siteUrl}/maattabellen`, changeFrequency: "monthly", priority: 0.6 },
    // Canonieke categorie-PLP's (de volledige listings) — statisch, dus altijd mee.
    ...CATEGORIES.map((c) => ({
      url: `${siteUrl}/categorie/${c.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...BRANDS.map((b) => ({
      url: `${siteUrl}/merken/${b.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...SIZE_GUIDES.map((g) => ({
      url: `${siteUrl}/maattabellen/${g.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];

  try {
    // Dynamische bronnen fail-soft: valt één weg, dan blijft de rest staan.
    const [collections, productHandles, blog, looks] = await Promise.all([
      listCollections().catch(() => []),
      listProductHandles().catch(() => []),
      getBlogPosts().catch(() => []),
      getAllLooks().catch(() => []),
    ]);
    return [
      ...base,
      ...collections.map((c) => ({
        url: `${siteUrl}/collections/${c.handle}`,
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
      ...blog.map((p) => ({
        url: `${siteUrl}/blog/${p.slug}`,
        lastModified: p.publishedAt || undefined,
        changeFrequency: "monthly" as const,
        priority: 0.5,
      })),
      ...looks.map((l) => ({
        url: `${siteUrl}/looks/${l.slug}`,
        changeFrequency: "monthly" as const,
        priority: 0.5,
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
