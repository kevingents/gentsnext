import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { Gallery } from "@/components/pdp/gallery";
import { BuyBox, type BuyColor } from "@/components/pdp/buy-box";
import { Accordion } from "@/components/pdp/accordion";
import { PdpSizeProvider } from "@/components/pdp/pdp-size-context";
import { ProductCard } from "@/components/product-card";
import { TrackRecent } from "@/components/recent/track-recent";
import { RecentStrip } from "@/components/recent/recent-strip";
import { ShareRow } from "@/components/pdp/share-row";
import { ShopTheLook } from "@/components/looks/shop-the-look";
import { getProductByHandle, getRecommendations, getVariantSiblings } from "@/lib/catalog";
import { buildModelLook, resolveLook } from "@/lib/looks";
import { smartModelLook } from "@/lib/model-styling";
import { getSettings } from "@/lib/settings";
import { getColorSiblings } from "@/lib/color-siblings";
import { sizeChartFor } from "@/lib/size-charts";
import { faqFor } from "@/lib/pdp-faq";
import { categoryByHoofdgroep } from "@/lib/categories";
import { parseRating } from "@/lib/reviews";
import { getReviewSummary, getPublishedReviews } from "@/lib/reviews-db";
import { ReviewsSection } from "@/components/reviews/reviews-section";
import { pickupInfoByCity } from "@/lib/stores";
import { BRANCH_CITY } from "@/lib/fulfillment-config";
import { estimateDelivery } from "@/lib/fulfillment";
import { getReferencePrices } from "@/lib/pricing";
import { getSiteUrl } from "@/lib/site-url";
import { localeAlternates } from "@/lib/seo";
import { parseComposition, parseCare, careProse } from "@/lib/care";
import { MaterialBlock, CareBlock } from "@/components/pdp/care-material";
import { sortSizes } from "@/lib/sizing";
import { stockForSkus, stockAvailable } from "@/lib/stock";
import { getSessionCustomer } from "@/lib/account";
import { resolveMySize } from "@/lib/size-match";

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
  "Gratis retour binnen 14 dagen — ook in de winkel",
  "Gratis vermaken in onze winkels",
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
    alternates: await localeAlternates(`/products/${handle}`),
    openGraph: images[0] ? { images: [{ url: images[0].url }] } : undefined,
  };
}

export default async function ProductPage({ params }: Props) {
  const { handle } = await params;
  const data = await getProductByHandle(handle);
  if (!data) notFound();
  const { product, variants, images, collections, sizeMedia } = data;
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
      // Alleen retail-winkels zijn afhaalbaar (geen magazijn); verrijk met
      // openingstijden zodat de klant ziet of hij er vandaag nog terecht kan.
      branches:
        st?.byBranch
          .filter((b) => Boolean(BRANCH_CITY[b.branchId]))
          .map((b) => {
            const city = BRANCH_CITY[b.branchId];
            const info = pickupInfoByCity(city);
            return { store: b.store, qty: b.qty, openNow: info?.openNow ?? false, openLabel: info?.label ?? "" };
          })
          // open winkels eerst, dan op voorraad
          .sort((a, b) => Number(b.openNow) - Number(a.openNow) || b.qty - a.qty) ?? [],
    });
  }
  const colors: BuyColor[] = [...colorMap.values()].map((c) => ({
    ...c,
    sizes: sortSizes(c.sizes),
  }));
  const anyInStock =
    !hasStock || colors.some((c) => c.sizes.some((s) => !s.known || s.qty > 0));

  // Representatieve (best op voorraad) variant voor de bezorgbelofte op de PDP.
  let representativeSku = "";
  let bestQty = 0;
  for (const c of colors) {
    for (const s of c.sizes) {
      if (s.sku && s.qty > bestQty) {
        bestQty = s.qty;
        representativeSku = s.sku;
      }
    }
  }

  const specs = SPEC_LABELS.map(([key, label]) => ({
    label,
    value: String(attrs[key] ?? "").trim(),
  })).filter((s) => s.value);

  const hoofdgroep = String(attrs.hoofdgroep_omschrijving || "");
  // Shop in jouw maat: voor ingelogde klanten de opgeslagen maat voorselecteren.
  const sessionCustomer = await getSessionCustomer();
  const mySize = resolveMySize(hoofdgroep, sessionCustomer?.sizeProfile);
  const rating = parseRating(attrs);
  // Voorkeur: eigen categoriepagina (volledige listing) boven Shopify-collectie.
  const cat = categoryByHoofdgroep(hoofdgroep);
  const breadcrumb = cat
    ? { handle: `__cat__${cat.slug}`, title: cat.label }
    : collections.find((c) => !c.handle.includes("all-products")) ?? collections[0];
  const breadcrumbHref = cat
    ? `/categorie/${cat.slug}`
    : breadcrumb ? `/collections/${breadcrumb.handle}` : "";
  const [recommendations, metafieldSiblings, variantSiblings, reviewSummary, productReviews, delivery] = await Promise.all([
    getRecommendations(hoofdgroep, product.id, 4),
    getColorSiblings(attrs, product.handle),
    getVariantSiblings(product.variantGroupKey || "", product.handle),
    getReviewSummary(product.handle),
    getPublishedReviews(product.handle, 30),
    representativeSku ? estimateDelivery([{ sku: representativeSku, qty: 1 }]) : Promise.resolve(null),
  ]);
  // Eigen (native) reviews hebben voorrang op het legacy Judge.me-aggregaat.
  const displayRating = reviewSummary ? { value: reviewSummary.value, count: reviewSummary.count } : rating;
  // Shop de look op de AI-modelfoto: het canvas-model draagt een vaste outfit;
  // we maken die (samen met dit product) klikbaar/shoppbaar.
  const settings = await getSettings();
  const modelLook = product.modelImageUrl
    ? await smartModelLook(
        {
          handle: product.handle,
          hoofdgroep,
          title: product.title,
          colorLabel: product.variantColorLabel,
          modelImageUrl: product.modelImageUrl,
        },
        settings.modelLook,
        settings.modelLook.minStock,
      ).catch(() =>
        // Val terug op de statische config als de slimme query faalt.
        buildModelLook({ handle: product.handle, hoofdgroep, modelImageUrl: product.modelImageUrl, title: product.title }, settings.modelLook),
      )
    : null;
  const resolvedModelLook = modelLook ? await resolveLook(modelLook) : null;

  // Voorkeur: kleurvarianten uit de titel-groepering (dekt o.a. de 235 dassen-
  // /pochet-/strik-groepen); val terug op Shopify group_data-metafield.
  const colorSiblings =
    variantSiblings.length >= 2
      ? variantSiblings.map((s) => ({
          handle: s.handle,
          colorName: s.colorLabel,
          imageUrl: s.imageUrl,
          isCurrent: s.isCurrent,
          inStock: s.inStock,
        }))
      : metafieldSiblings;

  const productJsonLd: Record<string, unknown> = {
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
  if (displayRating) {
    productJsonLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: displayRating.value.toFixed(1),
      reviewCount: displayRating.count,
      bestRating: 5,
      worstRating: 1,
    };
  }
  // Eigen reviews als Review-objecten (rich results) — alleen met tekst.
  if (productReviews.length) {
    productJsonLd.review = productReviews
      .filter((r) => r.body)
      .slice(0, 10)
      .map((r) => ({
        "@type": "Review",
        reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 },
        author: { "@type": "Person", name: r.authorName },
        datePublished: r.createdAt.slice(0, 10),
        ...(r.title ? { name: r.title } : {}),
        reviewBody: r.body,
      }));
  }

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
              item: `${siteUrl}${breadcrumbHref}`,
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

  // Materiaal + Onderhoud automatisch uit de SRS-data (samenstelling + wasvoorschrift).
  const composition = parseComposition(String(attrs.samenstelling_materiaal ?? attrs.samenstelling ?? ""));
  const careItems = parseCare(String(attrs.wasvoorschrift ?? attrs.wasvoorschriften ?? ""), attrs);
  const careProseLines = careProse(String(attrs.wasvoorschrift ?? ""));
  const materiaal = String(attrs.materiaal ?? "").trim();

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
    ...(composition.length || materiaal
      ? [{ title: "Materiaal", content: <MaterialBlock composition={composition} fallback={materiaal} /> }]
      : []),
    ...(careItems.length || careProseLines.length
      ? [{ title: "Onderhoud", content: <CareBlock items={careItems} prose={careProseLines} /> }]
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
            <Link href={breadcrumbHref} className="hover:text-ink">
              {breadcrumb.title}
            </Link>
          </>
        ) : null}
        {" / "}
        <span className="text-ink">{product.title}</span>
      </nav>

      <PdpSizeProvider>
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
        <Gallery
          images={[
            // AI-modelfoto leidt de galerij ("model eerst"), echte foto's erna.
            ...(product.modelImageUrl ? [{ url: product.modelImageUrl, alt: product.modelImageAlt || product.title }] : []),
            ...images.map((i) => ({ url: i.url, alt: i.alt })),
          ]}
          title={product.title}
          sizeMedia={sizeMedia}
        />

        <div className="lg:sticky lg:top-24 lg:self-start">
          <BuyBox
            title={product.title}
            vendor={String(attrs.merk || product.vendor || "")}
            rating={displayRating}
            hoofdgroep={hoofdgroep}
            sizeChartHandle={sizeChartFor(hoofdgroep)}
            productHandle={product.handle}
            image={images[0]?.url || ""}
            colors={colors}
            minPriceCents={minPrice}
            maxPriceCents={maxPrice}
            referenceCents={referenceCents}
            hasStock={hasStock}
            colorSiblings={colorSiblings}
            deliveryPromise={delivery?.promise ?? null}
            deliveryNote={delivery?.note ?? null}
            cutoffHour={delivery?.cutoffHour ?? 16}
            mySize={mySize?.raw ?? null}
          />

          {String(attrs.pasvorm ?? "").trim() ? (
            <p className="mt-6 rounded-card bg-surface px-3 py-2 font-sans text-xs text-ink-soft">
              <span className="font-medium text-ink">Pasvorm: {String(attrs.pasvorm)}.</span> Twijfel je tussen twee maten? Kies de grootste.
            </p>
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
          <ShareRow title={product.title} />
        </div>
      </div>
      </PdpSizeProvider>

      {/* Shop de look — de outfit van het model klikbaar/shoppbaar */}
      {resolvedModelLook && resolvedModelLook.products.some((h) => h.product) ? (
        <section className="mt-20">
          <p className="label-brand">Shop de look</p>
          <h2 className="mt-2 text-display-md">Zo draag je het</h2>
          <p className="mt-2 max-w-prose font-sans text-ink-soft">
            Gestyled op ons model. Klik op een onderdeel om het te shoppen — of shop de hele outfit in één keer.
          </p>
          <div className="mt-8">
            <ShopTheLook look={resolvedModelLook} aspectClass="aspect-[2/3]" />
          </div>
        </section>
      ) : null}

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

      <ReviewsSection handle={product.handle} summary={reviewSummary} reviews={productReviews} />

      <RecentStrip exclude={product.handle} />
    </div>
  );
}
