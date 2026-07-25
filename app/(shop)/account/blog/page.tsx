import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { getBlogPosts, BLOG_TOPICS } from "@/lib/blog";
import { BackofficeShell } from "@/components/account/report-ui";
import { BlogManager, type AdminPost } from "@/components/account/blog-manager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stijlgids", robots: { index: false, follow: false } };

/**
 * Site-studio → Stijlgids. De AI-adviesartikelen op /blog (lib/blog): lezen,
 * redigeren en een nieuw artikel laten schrijven. De cron doet dit ~2-wekelijks
 * zelf; hier kan de beheerder het handmatig aftrappen en de tekst bijschaven.
 */
export default async function BlogAdminPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");

  if (!customer.isAdmin) {
    return (
      <div className="mx-auto max-w-page px-gutter py-16">
        <h1 className="text-display-md">Geen toegang</h1>
        <p className="mt-3 font-sans text-ink-soft">Deze pagina is alleen voor beheerders.</p>
        <Link href="/account" className="mt-6 inline-block font-sans text-sm text-ink underline">← Terug naar mijn account</Link>
      </div>
    );
  }

  const posts = await getBlogPosts();
  // Genereren draait op Claude; zonder sleutel tonen we dat vooraf i.p.v. een
  // mislukte knop (generateBlogPost geeft dan simpelweg null terug).
  const aiReady = Boolean(process.env.ANTHROPIC_API_KEY);

  const items: AdminPost[] = posts.map((p) => ({
    slug: p.slug,
    topicKey: p.topicKey,
    title: p.title,
    excerpt: p.excerpt || "",
    intro: p.intro || "",
    seoTitle: p.seoTitle || "",
    seoDescription: p.seoDescription || "",
    occasion: p.occasion || "",
    heroImage: p.heroImage || "",
    author: p.author || "",
    publishedAt: p.publishedAt,
    sections: (p.sections || []).map((s) => ({
      heading: s.heading,
      body: s.body,
      productHandles: s.productHandles || [],
    })),
  }));

  const topics = BLOG_TOPICS.map((t) => ({ key: t.key, title: t.title }));
  const usedTopics = new Set(items.map((p) => p.topicKey));

  return (
    <BackofficeShell active="/account/blog" title="Stijlgids">
      <p className="font-sans text-sm text-pslate">
        De adviesartikelen op /blog. Ze citeren uitsluitend producten die op dat moment op voorraad waren; de tekst kun
        je hier bijschaven. Nieuwe artikelen komen ook automatisch binnen via de tweewekelijkse cron.
      </p>
      <BlogManager
        posts={items}
        topics={topics.map((t) => ({ ...t, used: usedTopics.has(t.key) }))}
        aiReady={aiReady}
      />
    </BackofficeShell>
  );
}
