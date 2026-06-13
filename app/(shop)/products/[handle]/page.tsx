import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { Gallery } from "@/components/pdp/gallery";
import { BuyBox, type BuyColor } from "@/components/pdp/buy-box";
import { Accordion } from "@/components/pdp/accordion";
import { ColorSiblings } from "@/components/pdp/color-siblings";
import { ProductCard } from "@/components/product-card";
import { TrackRecent } from "@/components/recent/track-recent";
import { RecentStrip } from "@/components/recent/recent-strip";
import { getProductByHandle, getRecommendations } from "@/lib/catalog";
import { getColorSiblings } from "@/lib/color-siblings";
import { sizeChartFor } from "@/lib/size-charts";
import { faqFor } from "@/lib/pdp-faq";
import { getReferencePrices } from "@/lib/pricing";
import { getSiteUrl } from "@/lib/site-url";
import { sortSizes } from "@/lib/sizing";
import { stockForSkus, stockAvailable } from "@/lib/stock";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };

const SPEC_LABELS: [key: string, label: string][] = [
  ["merk", "Merk"],
  ["materiaal", "Materiaal"],
  ["samenstelling_materiaal", "Samenstelling"],
  ["pasvorm", "Pasvorm"],
  ["sluiting", "Sluiting"],
  ["boord", "Boord"],
  ["manchet", "Manchet"],
  ["zakken", "Zakken"],
  ["seizoen", "Seizoen"],
  ["wasvoorschrift", "Wasvoorschrift"],
];

const TRUST = [
  "Gratis retour binnen 14 dagen",
  "Persoonlijk advies in 19 winkels",
  "Veilig betalen met iDEAL",
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

  const [referencePrices, stockMap, hasStock] = await Promise.all([
    getReferencePrices(variants.map((v) => v.id)),
    stockForSkus(variants.map((v) => v.sku).filter(Boolean)),
    stockAvailable(),
  ]);
  const referenceCents = referencePrices.get(cheapest.id);

  // Bouw kleuren → maten met voorraad voor de buy-box.
  const colorMap = new Map<string, BuyColor>();
  for (const v of variants) {
    if (!v.size) continue;
    const color = v.color || "Standaard";
    let entry = colorMap.get(color);
    if (!entry) {
      entry = { color, sizes: [] };
      colorMap.set(color, entry);
    }
    if (entry.sizes.some((s) => s.size === v.size)) continue;
    const st = v.sku ? stockMap.get(v.sku) : undefined;
    entry.sizes.push({
      size: v.size,
      sku: v.sku,
      priceCents: v.priceCents,
      qty: st?.online ?? 0,
      known: hasStock && Boolean(v.sku),
      branches: st?.byBranch.map((b) => ({ store: b.store, qty: b.qty })) ?? [],
    });
  }
  const colors: BuyColor[] = [...colorMap.values()].map((c) => ({
    ...c,
    sizes: sortSizes(c.sizes),
  }));
  const anyInStock =
    !hasStock || colors.some((c) => c.sizes.some((s) => !s.known || s.qty > 0));

  const specs = SPEC_LABELS.map(([key, label]) => ({
    label,
    value: String(attrs[key] ?? "").trim(),
  })).filter((s) => s.value);

  const breadcrumb = collections.find((c) => !c.handle.includes("all-products")) ?? collections[0];
  const hoofdgroep = String(attrs.hoofdgroep_omschrijving || "");
  const [recommendations, colorSiblings] = await Promise.all([
    getRecommendations(hoofdgroep, product.id, 4),
    getColorSiblings(attrs, product.handle),
  ]);

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: stripHtml(product.descriptionHtml).slice(0, 5000),
    image: images.map((img) => img.url),
    brand: { "@type": "Brand", name: String(attrs.merk || product.vendor || "GENTS") },
    url: `${siteUrl}/products/${product.handle}`,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "EUR",
      lowPrice: (minPrice / 100).toFixed(2),
      highPrice: (maxPrice / 100).toFixed(2),
      offerCount: variants.length,
      availability: anyInStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
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

  const accordionItems = [
    ...(product.descriptionHtml
      ? [
          {
            title: "Productomschrijving",
            content: (
              <div
                className="max-w-none font-sans text-sm leading-relaxed text-ink-soft [&_a]:underline [&_h3]:mt-3 [&_h3]:font-medium [&_h3]:text-ink"
                dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
              />
            ),
          },
        ]
      : []),
    ...(specs.length
      ? [
          {
            title: "Specificaties",
            content: (
              <dl className="divide-y divide-line border-y border-line">
                {specs.map((spec) => (
                  <div key={spec.label} className="flex justify-between gap-4 py-2.5 font-sans text-sm">
                    <dt className="text-muted">{spec.label}</dt>
                    <dd className="text-right text-ink">{spec.value}</dd>
                  </div>
                ))}
              </dl>
            ),
          },
        ]
      : []),
    {
      title: "Bezorging & retour",
      content: (
        <div className="font-sans text-sm leading-relaxed text-ink-soft">
          <p>Gratis retourneren binnen 14 dagen. Ophalen in één van onze 19 winkels is ook mogelijk.</p>
          <p className="mt-2">
            Twijfel je over je maat? Gebruik ons{" "}
            <Link href="/maatadvies" className="text-ink underline underline-offset-4">
              maatadvies
            </Link>{" "}
            of vraag het in de winkel.
          </p>
        </div>
      ),
    },
    {
      title: "Veelgestelde vragen",
      content: (
        <dl className="font-sans text-sm">
          {faqFor(hoofdgroep).map((f) => (
            <div key={f.q} className="py-3 first:pt-0 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line">
              <dt className="font-medium text-ink">{f.q}</dt>
              <dd className="mt-1 leading-relaxed text-ink-soft">{f.a}</dd>
            </div>
          ))}
        </dl>
      ),
    },
  ];

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqFor(hoofdgroep).map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="mx-auto max-w-page px-gutter py-8 pb-28 lg:pb-8">
      <JsonLd data={productJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={faqJsonLd} />
      <TrackRecent handle={product.handle} />

      <nav className="font-sans text-sm text-muted" aria-label="Kruimelpad">
        <Link href="/" className="hover:text-ink">
          Home
        </Link>
        {breadcrumb ? (
          <>
            {" / "}
            <Link href={`/collections/${breadcrumb.handle}`} className="hover:text-ink">
              {breadcrumb.title}
            </Link>
          </>
        ) : null}
        {" / "}
        <span className="text-ink">{product.title}</span>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <Gallery images={images.map((i) => ({ url: i.url, alt: i.alt }))} title={product.title} />

        <div className="lg:sticky lg:top-24 lg:self-start">
          <BuyBox
            title={product.title}
            vendor={String(attrs.merk || product.vendor || "")}
            hoofdgroep={hoofdgroep}
            sizeChartHandle={sizeChartFor(hoofdgroep)}
            productHandle={product.handle}
            image={images[0]?.url || ""}
            colors={colors}
            minPriceCents={minPrice}
            maxPriceCents={maxPrice}
            referenceCents={referenceCents}
            hasStock={hasStock}
          />

          {colorSiblings.length > 0 ? (
            <div className="mt-7">
              <ColorSiblings siblings={colorSiblings} />
            </div>
          ) : null}

          <ul className="mt-8 space-y-1.5">
            {TRUST.map((t) => (
              <li key={t} className="flex items-center gap-2 font-sans text-sm text-ink-soft">
                <span aria-hidden className="text-success">
                  ✓
                </span>
                {t}
              </li>
            ))}
          </ul>

          <div className="mt-8">
            <Accordion items={accordionItems} />
          </div>
        </div>
      </div>

      {/* Maak de look compleet — slimme bijverkoop */}
      {recommendations.length > 0 ? (
        <section className="mt-20">
          <p className="label-brand">Maak de look compleet</p>
          <h2 className="mt-2 text-display-md">Hier draag je het bij</h2>
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
            {recommendations.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}

      <RecentStrip exclude={product.handle} />
    </div>
  );
}
