import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { listCollections } from "@/lib/catalog";
import { CATEGORIES } from "@/lib/categories";
import { localeAlternates } from "@/lib/seo";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Collecties", alternates: await localeAlternates("/collections") };
}

// Categorie-tegels met merkfotografie — visueel ipv platte lijst.
const FEATURED: { slug: string; img: string }[] = [
  { slug: "pakken", img: "/brand/brand-model-charcoal.jpg" },
  { slug: "overhemden", img: "/brand/brand-product-fabric.jpg" },
  { slug: "colberts", img: "/brand/brand-model-navy.jpg" },
  { slug: "pantalons", img: "/brand/brand-model-grey3piece.jpg" },
  { slug: "stropdassen", img: "/brand/brand-product-flatlay.jpg" },
  { slug: "schoenen", img: "/brand/brand-product-lifestyle.jpg" },
];

export default async function CollectionsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const collections = await listCollections();
  const featured = FEATURED.map((f) => {
    const cat = CATEGORIES.find((c) => c.slug === f.slug);
    return cat ? { ...cat, img: f.img } : null;
  }).filter(Boolean) as { slug: string; label: string; hoofdgroep: string; img: string }[];

  return (
    <div>
      {/* Categorie-tegels */}
      <section className="mx-auto max-w-page px-gutter py-12">
        <p className="label-brand">{t("collections.categories.eyebrow")}</p>
        <h1 className="mt-2 text-display-md">{t("collections.title")}</h1>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {featured.map((c) => (
            <Link
              key={c.slug}
              href={`/categorie/${c.slug}`}
              className="group relative aspect-[4/5] overflow-hidden rounded-card bg-surface"
            >
              <Image
                src={c.img}
                alt={c.label}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                className="object-cover transition duration-500 ease-brand group-hover:scale-[1.04]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/65 to-transparent" />
              <span className="absolute bottom-4 left-4 font-display text-xl font-light text-canvas">{c.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Themacollecties */}
      <section className="mx-auto max-w-page px-gutter pb-16">
        <p className="label-brand">{t("collections.themed.eyebrow")}</p>
        <h2 className="mt-2 text-display-md">{t("collections.themed.title")}</h2>
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {collections.map((c) => (
            <li key={c.id}>
              <Link
                href={`/collections/${c.handle}`}
                className="flex items-center justify-between border border-line bg-canvas px-5 py-4 font-sans text-sm transition-colors hover:border-ink"
              >
                <span>{c.title}</span>
                <span aria-hidden className="text-muted">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
