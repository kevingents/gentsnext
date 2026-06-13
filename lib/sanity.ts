import { createClient } from "next-sanity";
import imageUrlBuilder from "@sanity/image-url";
import { projectId, dataset, apiVersion, sanityConfigured } from "@/sanity/env";

export { sanityConfigured };

export const sanityClient = sanityConfigured
  ? createClient({ projectId, dataset, apiVersion, useCdn: true })
  : null;

const builder = sanityConfigured ? imageUrlBuilder({ projectId, dataset } as any) : null;

/** Bouwt een geoptimaliseerde URL voor een Sanity-afbeelding (of "" als geen). */
export function urlForImage(source: any, width = 1200): string {
  if (!builder || !source?.asset) return "";
  return builder.image(source).width(width).fit("max").auto("format").url();
}

/** GROQ-fetch; geeft null als Sanity niet geconfigureerd is (→ statische fallback). */
export async function sanityFetch<T>(query: string, params: Record<string, unknown> = {}): Promise<T | null> {
  if (!sanityClient) return null;
  try {
    return await sanityClient.fetch<T>(query, params, { next: { revalidate: 60 } });
  } catch (e) {
    console.error("[sanity] fetch-fout:", e instanceof Error ? e.message : e);
    return null;
  }
}

/* ── Content-queries ──────────────────────────────────────────────────── */

export type SanityLanding = {
  title: string;
  slug: string;
  eyebrow?: string;
  intro?: string;
  heroImage?: any;
  sections?: { title?: string; body?: string; image?: any }[];
  shop?: { label?: string; href?: string }[];
  ctaLabel?: string;
  ctaHref?: string;
  seoDescription?: string;
};

export type SanityPage = {
  title: string;
  slug: string;
  body?: any[];
  legacyHtml?: string;
  seoDescription?: string;
};

export function getSanityLanding(slug: string) {
  return sanityFetch<SanityLanding>(
    `*[_type == "landing" && slug.current == $slug][0]{
      title, "slug": slug.current, eyebrow, intro, heroImage,
      sections[]{title, body, image}, shop[]{label, href}, ctaLabel, ctaHref, seoDescription
    }`,
    { slug }
  );
}

export function getSanityPage(slug: string) {
  return sanityFetch<SanityPage>(
    `*[_type == "page" && slug.current == $slug][0]{
      title, "slug": slug.current, body, legacyHtml, seoDescription
    }`,
    { slug }
  );
}
