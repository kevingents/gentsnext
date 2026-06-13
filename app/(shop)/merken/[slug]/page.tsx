import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product-card";
import { JsonLd } from "@/components/json-ld";
import { brandBySlug } from "@/lib/brands";
import { getProductsByBrand } from "@/lib/catalog";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const brand = brandBySlug(slug);
  if (!brand) return {};
  return {
    title: brand.name,
    description: brand.intro,
    alternates: { canonical: `/merken/${slug}` },
  };
}

export default async function BrandPage({ params }: Props) {
  const { slug } = await params;
  const brand = brandBySlug(slug);
  if (!brand) notFound();
  const products = await getProductsByBrand(brand.vendor, 48);

  const siteUrl = getSiteUrl();
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: "Merken", item: `${siteUrl}/merken` },
      { "@type": "ListItem", position: 3, name: brand.name, item: `${siteUrl}/merken/${slug}` },
    ],
  };

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <section className="relative h-[42vh] min-h-[320px] w-full overflow-hidden bg-ink">
        <Image
          src={brand.heroImage}
          alt={brand.name}
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-85"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/75 via-ink/15 to-transparent" />
        <div className="absolute inset-0 mx-auto flex max-w-page flex-col items-start justify-end px-gutter pb-12">
          <p className="label-brand !text-canvas/80">Merk</p>
          <h1 className="mt-2 text-display-xl font-light text-canvas">{brand.name}</h1>
        </div>
      </section>

      <div className="mx-auto max-w-page px-gutter py-10">
        <nav className="font-sans text-sm text-muted" aria-label="Kruimelpad">
          <Link href="/" className="hover:text-ink">Home</Link>
          {" / "}
          <span className="text-ink">{brand.name}</span>
        </nav>

        <p className="mt-6 max-w-2xl font-sans text-ink-soft">{brand.intro}</p>
        <p className="mt-2 font-sans text-sm text-muted">{products.length}+ artikelen</p>

        {products.length === 0 ? (
          <p className="mt-12 font-sans text-ink-soft">Op dit moment geen producten beschikbaar.</p>
        ) : (
          <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
