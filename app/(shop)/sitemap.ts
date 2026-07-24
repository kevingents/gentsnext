import type { MetadataRoute } from "next";
import { listCollections, listProductHandles } from "@/lib/catalog";
import { getSiteUrl } from "@/lib/site-url";
import { LOCALES, HREFLANG, localePrefix, DEFAULT_LOCALE } from "@/lib/i18n";
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
/**
 * Taalvarianten van één (prefix-loos) pad als hreflang-alternates. De
 * anderstalige URL's (/de/… /en/…) stonden niet in de sitemap én worden nergens
 * náár gelinkt — daardoor waren ze voor Google praktisch onvindbaar. Google
 * leest deze `alternates.languages` uit als xhtml:link-annotaties.
 */
function withLanguages(siteUrl: string, path: string) {
  const languages: Record<string, string> = {};
  for (const l of LOCALES) {
    if (l === DEFAULT_LOCALE) continue;
    languages[HREFLANG[l]] = `${siteUrl}${localePrefix(l)}${path === "/" ? "" : path}`;
  }
  return { alternates: { languages } };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const base: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: "daily", priority: 1, ...withLanguages(siteUrl, "/") },
    { url: `${siteUrl}/collections`, changeFrequency: "weekly", priority: 0.6, ...withLanguages(siteUrl, "/collections") },
    { url: `${siteUrl}/blog`, changeFrequency: "weekly", priority: 0.6, ...withLanguages(siteUrl, "/blog") },
    { url: `${siteUrl}/looks`, changeFrequency: "weekly", priority: 0.6, ...withLanguages(siteUrl, "/looks") },
    { url: `${siteUrl}/gelegenheden`, changeFrequency: "monthly", priority: 0.6, ...withLanguages(siteUrl, "/gelegenheden") },
    { url: `${siteUrl}/afspraak`, changeFrequency: "monthly", priority: 0.6, ...withLanguages(siteUrl, "/afspraak") },
    { url: `${siteUrl}/maatadvies`, changeFrequency: "monthly", priority: 0.6, ...withLanguages(siteUrl, "/maatadvies") },
    { url: `${siteUrl}/maattabellen`, changeFrequency: "monthly", priority: 0.6, ...withLanguages(siteUrl, "/maattabellen") },
    // Canonieke categorie-PLP's (de volledige listings) — statisch, dus altijd mee.
    ...CATEGORIES.map((c) => ({
      url: `${siteUrl}/categorie/${c.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
      ...withLanguages(siteUrl, `/categorie/${c.slug}`),
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
        ...withLanguages(siteUrl, `/collections/${c.handle}`),
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
        ...withLanguages(siteUrl, `/products/${p.handle}`),
      })),
    ];
  } catch {
    return base;
  }
}
