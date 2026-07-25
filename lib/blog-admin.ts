import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import type { BlogPost, BlogSection } from "@/lib/blog";

/**
 * Handmatig bijwerken van een stijlgids-artikel. lib/blog.ts kan artikelen
 * genereren, lezen en verwijderen, maar niet redigeren — dat gebeurde tot nu toe
 * nergens. Deze module schrijft in dezelfde app_settings-rij (`blogPosts`) en
 * raakt alleen de velden aan die de beheerder mag redigeren; gegenereerde
 * koppelingen (topicKey, publishedAt, heroImage) blijven staan.
 */
const ID = "blogPosts";

export type BlogPostPatch = {
  title?: string;
  excerpt?: string;
  intro?: string;
  sections?: BlogSection[];
  seoTitle?: string;
  seoDescription?: string;
};

async function readPosts(): Promise<BlogPost[]> {
  const db = getDb();
  const rows = await db.select().from(appSettings).where(eq(appSettings.id, ID)).limit(1);
  const data = rows[0]?.data as { posts?: BlogPost[] } | undefined;
  return Array.isArray(data?.posts) ? data!.posts! : [];
}

/**
 * Werkt één artikel bij. Geeft het bijgewerkte artikel terug, of null als de slug
 * niet bestaat (dan schrijven we niets — geen stille no-op die "gelukt" meldt).
 */
export async function updateBlogPost(slug: string, patch: BlogPostPatch): Promise<BlogPost | null> {
  const key = String(slug || "").trim();
  if (!key) return null;
  const posts = await readPosts();
  const idx = posts.findIndex((p) => p.slug === key);
  if (idx < 0) return null;

  const current = posts[idx];
  const next: BlogPost = {
    ...current,
    title: patch.title !== undefined ? patch.title : current.title,
    excerpt: patch.excerpt !== undefined ? patch.excerpt : current.excerpt,
    intro: patch.intro !== undefined ? patch.intro : current.intro,
    sections: patch.sections !== undefined ? patch.sections : current.sections,
    seoTitle: patch.seoTitle !== undefined ? patch.seoTitle || undefined : current.seoTitle,
    seoDescription: patch.seoDescription !== undefined ? patch.seoDescription || undefined : current.seoDescription,
  };
  // Producthandles volgen de secties — anders wijst "In onze stijlgids" op de PDP
  // naar een artikel waar het product niet meer in staat.
  next.productHandles = [...new Set(next.sections.flatMap((s) => s.productHandles))];
  posts[idx] = next;

  const db = getDb();
  await db
    .insert(appSettings)
    .values({ id: ID, data: { posts }, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: { posts }, updatedAt: sql`now()` } });
  return next;
}
