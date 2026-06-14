import { createClient } from "next-sanity";
import imageUrlBuilder from "@sanity/image-url";
import { projectId, dataset, apiVersion, sanityConfigured } from "@/sanity/env";

export { sanityConfigured };

// Server-only lees-token (werkt ook bij een private dataset). lib/sanity wordt
// alleen server-side gebruikt (server components), dus dit lekt niet client-side.
const readToken = process.env.SANITY_API_KEY || process.env.SANITY_API_TOKEN;

export const sanityClient = sanityConfigured
  ? createClient({
      projectId,
      dataset,
      apiVersion,
      useCdn: !readToken,
      token: readToken || undefined,
      perspective: "published",
    })
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
    // tag 'sanity' → de revalidate-webhook kan alle content in één keer verversen.
    return await sanityClient.fetch<T>(query, params, { next: { revalidate: 60, tags: ["sanity"] } });
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

export type SanityLook = {
  title: string;
  slug: string;
  occasion?: string;
  subtitle?: string;
  image?: any;
  order?: number;
  hotspots?: { label?: string; handle?: string; x?: number; y?: number }[];
};

const LOOK_PROJECTION = `{
  title, "slug": slug.current, occasion, subtitle, image, order,
  hotspots[]{label, handle, x, y}
}`;

export function getSanityLooks() {
  return sanityFetch<SanityLook[]>(`*[_type == "look" && defined(slug.current)] | order(order asc, _createdAt desc) ${LOOK_PROJECTION}`);
}

export function getSanityLook(slug: string) {
  return sanityFetch<SanityLook>(`*[_type == "look" && slug.current == $slug][0] ${LOOK_PROJECTION}`, { slug });
}

export type SanityMenu = {
  items?: {
    label: string;
    href?: string;
    columns?: { title?: string; links?: { label: string; href: string }[] }[];
    feature?: { label?: string; caption?: string; href?: string; image?: any };
  }[];
};

const MENU_PROJECTION = `{
  items[]{
    label, href,
    columns[]{ title, links[]{ label, href } },
    feature{ label, caption, href, image }
  }
}`;

export function getSanityMenu() {
  return sanityFetch<SanityMenu>(`*[_type == "navigation"][0] ${MENU_PROJECTION}`);
}

export type SanityFooter = {
  intro?: string;
  columns?: { title?: string; links?: { label: string; href: string }[] }[];
};

const FOOTER_PROJECTION = `{ intro, columns[]{ title, links[]{ label, href } } }`;

export function getSanityFooter() {
  return sanityFetch<SanityFooter>(`*[_type == "footer"][0] ${FOOTER_PROJECTION}`);
}
