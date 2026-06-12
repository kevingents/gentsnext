import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { getProductByHandle } from "@/lib/catalog";
import { formatEuro, getReferencePrices } from "@/lib/pricing";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };

/** SRS-specificaties die als producteigenschappen getoond worden. */
const SPEC_LABELS: [key: string, label: string][] = [
  ["materiaal", "Materiaal"],
  ["samenstelling_materiaal", "Samenstelling"],
  ["pasvorm", "Pasvorm"],
  ["sluiting", "Sluiting"],
  ["boord", "Boord"],
  ["manchet", "Manchet"],
  ["zakken", "Zakken"],
  ["wasvoorschrift", "Wasvoorschrift"],
];

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const data = await getProductByHandle(handle);
  if (!data) return {};
  const { product, images } = data;
  return {
    title: product.seoTitle || product.title,
    description: product.seoDescription || stripHtml(product.descriptionHtml).slice(0, 160),
    // Zelfreferentiële canonical — vangt ook oude ?variant=-URL's af.
    alternates: { canonical: `/products/${handle}` },
    openGraph: images[0] ? { images: [{ url: images[0].url }] } : undefined,
  };
}

export default async function ProductPage({ params }: Props) {
  const { handle } = await params;
  const data = await getProductByHandle(handle);
  if (!data) notFound();
  const { product, variants, images, collections } = data;
  if (!variants.length) notFound();

  const siteUrl = getSiteUrl();
  const attrs = (product.attributes ?? {}) as Record<string, unknown>;
  const minPrice = Math.min(...variants.map((v) => v.priceCents));
  const maxPrice = Math.max(...variants.map((v) => v.priceCents));
  const cheapest = variants.find((v) => v.priceCents === minPrice)!;
  const referencePrices = await getReferencePrices(variants.map((v) => v.id));
  const referenceCents = referencePrices.get(cheapest.id);

  // Maten gegroepeerd per kleur (alleen weergave; bestellen volgt in fase 3).
  const sizesByColor = new Map<string, string[]>();
  for (const v of variants) {
    const color = v.color || "Standaard";
    const list = sizesByColor.get(color) || [];
    if (v.size && !list.includes(v.size)) list.push(v.size);
    sizesByColor.set(color, list);
  }

  const specs = SPEC_LABELS.map(([key, label]) => ({
    label,
    value: String(attrs[key] ?? "").trim(),
  })).filter((s) => s.value);

  const breadcrumb = collections[0];

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: stripHtml(product.descriptionHtml).slice(0, 5000),
    image: images.map((img) => img.url),
    brand: product.vendor ? { "@type": "Brand", name: product.vendor } : undefined,
    url: `${siteUrl}/products/${product.handle}`,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "EUR",
      lowPrice: (minPrice / 100).toFixed(2),
      highPrice: (maxPrice / 100).toFixed(2),
      offerCount: variants.length,
      availability: "https://schema.org/InStock",
      offers: variants.slice(0, 50).map((v) => ({
        "@type": "Offer",
        sku: v.sku || undefined,
        gtin13: /^\d{13}$/.test(v.barcode) ? v.barcode : undefined,
        price: (v.priceCents / 100).toFixed(2),
        priceCurrency: "EUR",
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/NewCondition",
      })),
    },
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      ...(breadcrumb
        ? [
            {
              "@type": "ListItem",
              position: 2,
              name: breadcrumb.title,
              item: `${siteUrl}/collections/${breadcrumb.handle}`,
            },
          ]
        : []),
      {
        "@type": "ListItem",
        position: breadcrumb ? 3 : 2,
        name: product.title,
        item: `${siteUrl}/products/${product.handle}`,
      },
    ],
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <JsonLd data={productJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />

      <nav className="text-sm text-slate" aria-label="Kruimelpad">
        <Link href="/" className="hover:text-navy">
          Home
        </Link>
        {breadcrumb ? (
          <>
            {" / "}
            <Link href={`/collections/${breadcrumb.handle}`} className="hover:text-navy">
              {breadcrumb.title}
            </Link>
          </>
        ) : null}
        {" / "}
        <span className="text-navy">{product.title}</span>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        {/* Afbeeldingen */}
        <div className="grid grid-cols-2 gap-3">
          {images.length ? (
            images.slice(0, 6).map((img, i) => (
              <div
                key={img.id}
                className={`relative overflow-hidden rounded-lg bg-white ${i === 0 ? "col-span-2 aspect-[4/5]" : "aspect-[3/4]"}`}
              >
                <Image
                  src={img.url}
                  alt={img.alt || product.title}
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover"
                  priority={i === 0}
                />
              </div>
            ))
          ) : (
            <div className="col-span-2 flex aspect-[4/5] items-center justify-center rounded-lg bg-white text-sm text-slate">
              Geen afbeeldingen
            </div>
          )}
        </div>

        {/* Productinfo */}
        <div>
          {product.vendor ? (
            <p className="text-xs uppercase tracking-widest text-slate">{product.vendor}</p>
          ) : null}
          <h1 className="mt-1 text-3xl font-semibold">{product.title}</h1>

          <div className="mt-4 flex items-baseline gap-3">
            {referenceCents ? (
              <span className="text-lg text-slate line-through">{formatEuro(referenceCents)}</span>
            ) : null}
            <span className="text-2xl font-semibold">
              {minPrice !== maxPrice ? "vanaf " : ""}
              {formatEuro(minPrice)}
            </span>
          </div>
          {referenceCents ? (
            <p className="mt-1 text-xs text-slate">
              Doorgestreepte prijs: laagste prijs in 30 dagen voorafgaand aan de korting.
            </p>
          ) : null}

          <div className="mt-6 space-y-4">
            {[...sizesByColor.entries()].map(([color, sizes]) => (
              <div key={color}>
                <p className="text-sm font-medium">{color}</p>
                {sizes.length ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {sizes.map((size) => (
                      <li
                        key={size}
                        className="rounded border border-navy-100 bg-white px-3 py-1.5 text-sm"
                      >
                        {size}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>

          <button
            type="button"
            disabled
            className="mt-8 w-full cursor-not-allowed rounded-lg bg-navy px-6 py-3 font-medium text-white opacity-60"
          >
            Online bestellen volgt binnenkort
          </button>

          {product.descriptionHtml ? (
            <div
              className="prose-sm mt-8 max-w-none text-slate [&_a]:underline [&_h3]:font-medium [&_h3]:text-navy"
              dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
            />
          ) : null}

          {specs.length ? (
            <section className="mt-8">
              <h2 className="text-sm font-medium uppercase tracking-wider text-slate">
                Specificaties
              </h2>
              <dl className="mt-3 divide-y divide-navy-50 rounded-lg bg-white px-4 shadow-card">
                {specs.map((spec) => (
                  <div key={spec.label} className="flex justify-between gap-4 py-2.5 text-sm">
                    <dt className="text-slate">{spec.label}</dt>
                    <dd className="text-right">{spec.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
