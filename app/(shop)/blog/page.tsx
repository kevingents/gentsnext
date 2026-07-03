import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getBlogPosts } from "@/lib/blog";
import { localeAlternates } from "@/lib/seo";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Stijlgids",
    description: "Adviezen, dresscodes en stylingtips van de stylisten van GENTS — perfect gekleed voor elk formeel moment.",
    alternates: await localeAlternates("/blog"),
  };
}

export default async function BlogIndex() {
  const locale = await getLocale();
  const t = await getT(locale);
  const posts = await getBlogPosts();
  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <p className="label-brand">{t("blog.label")}</p>
      <h1 className="mt-2 text-display-md">{t("blog.title")}</h1>
      <p className="mt-3 max-w-prose font-sans text-ink-soft">
        {t("blog.intro")}
      </p>

      {posts.length === 0 ? (
        <p className="mt-10 font-sans text-ink-soft">{t("blog.coming_soon")}</p>
      ) : (
        <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <Link key={p.slug} href={`/blog/${p.slug}`} className="group block">
              <div className="relative aspect-[4/5] overflow-hidden rounded-card bg-surface">
                {p.heroImage ? (
                  <Image src={p.heroImage} alt={p.title} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="object-cover transition-transform duration-500 ease-brand group-hover:scale-[1.04]" />
                ) : null}
              </div>
              <p className="mt-3 label-brand">{p.occasion || t("blog.label")}</p>
              <h2 className="mt-1 font-display text-xl font-light text-ink">{p.title}</h2>
              {p.excerpt ? <p className="mt-1 line-clamp-2 font-sans text-sm text-ink-soft">{p.excerpt}</p> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
