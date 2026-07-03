import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getBlogPost } from "@/lib/blog";
import { getProductsByHandles } from "@/lib/catalog";
import { ProductCard } from "@/components/product-card";
import { JsonLd } from "@/components/json-ld";
import { getSiteUrl } from "@/lib/site-url";
import { localeAlternates } from "@/lib/seo";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) return {};
  return {
    title: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt,
    alternates: await localeAlternates(`/blog/${slug}`),
    openGraph: { type: "article", ...(post.heroImage ? { images: [{ url: post.heroImage }] } : {}) },
  };
}

function paragraphs(text: string) {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export default async function BlogPostPage({ params }: Props) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) notFound();

  const cards = await getProductsByHandles(post.productHandles);
  const byHandle = new Map(cards.map((c) => [c.handle, c]));
  const siteUrl = getSiteUrl();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt || undefined,
    image: post.heroImage ? [post.heroImage] : undefined,
    author: { "@type": "Organization", name: "GENTS" },
    publisher: { "@type": "Organization", name: "GENTS" },
    datePublished: post.publishedAt,
    url: `${siteUrl}/blog/${post.slug}`,
  };

  return (
    <article className="mx-auto max-w-3xl px-gutter py-12">
      <JsonLd data={jsonLd} />
      <nav className="font-sans text-sm text-muted" aria-label={t("common.breadcrumb")}>
        <Link href="/" className="hover:text-ink">{t("common.home")}</Link>
        {" / "}
        <Link href="/blog" className="hover:text-ink">{t("blog.label")}</Link>
        {" / "}
        <span className="text-ink">{post.title}</span>
      </nav>

      <p className="label-brand mt-6">{post.occasion || t("blog.label")}</p>
      <h1 className="mt-2 text-display-md">{post.title}</h1>
      <p className="mt-2 font-sans text-sm text-muted">{t("blog.by_author")} {post.author}</p>

      {post.heroImage ? (
        <div className="relative mt-6 aspect-[4/5] max-h-[70vh] overflow-hidden rounded-card bg-surface">
          <Image src={post.heroImage} alt={post.title} fill sizes="(max-width: 768px) 100vw, 768px" className="object-cover" priority />
        </div>
      ) : null}

      {post.intro ? (
        <div className="mt-8 space-y-4 font-sans text-lg leading-relaxed text-ink-soft">
          {paragraphs(post.intro).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : null}

      {post.sections.map((s, i) => {
        const products = s.productHandles.map((h) => byHandle.get(h)).filter(Boolean);
        return (
          <section key={i} className="mt-12">
            <h2 className="font-display text-2xl font-light text-ink">{s.heading}</h2>
            <div className="mt-3 space-y-4 font-sans leading-relaxed text-ink-soft">
              {paragraphs(s.body).map((p, j) => (
                <p key={j}>{p}</p>
              ))}
            </div>
            {products.length > 0 ? (
              <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3">
                {products.map((p) => (p ? <ProductCard key={p.id} product={p} /> : null))}
              </div>
            ) : null}
          </section>
        );
      })}

      <div className="mt-14 border-t border-line pt-8">
        <p className="font-sans text-ink-soft">
          {t("blog.size_doubt")}{" "}
          <Link href="/maatadvies" className="text-ink underline underline-offset-4">{t("blog.use_sizing")}</Link>{" "}
          {t("blog.ask_stylists")}
        </p>
        <Link href="/blog" className="mt-4 inline-block font-sans text-sm text-ink underline underline-offset-4">{t("blog.back_to_blog")}</Link>
      </div>
    </article>
  );
}
