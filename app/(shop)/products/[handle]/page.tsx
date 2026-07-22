import type { Metadata } from "next";
import Image from "next/image";
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
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";
import { buildModelLook, buildSuitLook, resolveLook, getLookBuyData } from "@/lib/looks";
import { smartModelLook } from "@/lib/model-styling";
import { getSuitPieceHandles } from "@/lib/suit-pairing";
import { getSettings } from "@/lib/settings";
import { getColorSiblings } from "@/lib/color-siblings";
import { sortBySwatch } from "@/lib/colors";
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
import { parseComposition, parseCare, careProse, stripSymbols } from "@/lib/care";
import { MaterialBlock, CareBlock } from "@/components/pdp/care-material";
import { sortSizes } from "@/lib/sizing";
import { stockAvailable } from "@/lib/stock";
import { availableForSkus } from "@/lib/stock-reservations";
import { getSessionCustomer } from "@/lib/account";
import { resolveMySize } from "@/lib/size-match";
import { getProductViewStats } from "@/lib/social-proof";
import { SocialProof } from "@/components/pdp/social-proof";
import { getCachedReviewAiSummary } from "@/lib/review-summary";
import { AiReviewSummary } from "@/components/reviews/ai-summary";
import { getSeoOverride, applySeoOverride } from "@/lib/seo-overrides";
import { getProductContentOverride } from "@/lib/product-content";
import { getBlogPostsForProduct } from "@/lib/blog";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };

// [attribuut-sleutel, message-key] — labels lopen via t() mee met de locale.
const SPEC_LABELS: [key: string, msgKey: string][] = [
  ["merk", "pdp.specs.brand"],
  ["materiaal", "pdp.specs.material"],
  ["samenstelling_materiaal", "pdp.specs.composition"],
  ["pasvorm", "pdp.specs.fit"],
  ["sluiting", "pdp.specs.closure"],
  ["boord", "pdp.specs.collar"],
  ["manchet", "pdp.specs.cuff"],
  ["zakken", "pdp.specs.pockets"],
  ["seizoen", "pdp.specs.season"],
  // Geen rauwe 'wasvoorschrift' hier — dat staat schoon (SVG-iconen) onder Onderhoud.
];

// Bewust maar 2 regels: "persoonlijk advies" staat al in de topbar en "veilig
// betalen" al als badge-rij onder de bestelknop — dubbelingen maakten de PDP druk.
const TRUST_KEYS = [
  "pdp.trust_return",
  "pdp.trust_alteration",
];

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const data = await getProductByHandle(handle);
  if (!data) return {};
  const { product, images } = data;
  const meta: Metadata = {
    title: product.seoTitle || product.title,
    description: product.seoDescription || stripHtml(product.descriptionHtml).slice(0, 160),
    alternates: await localeAlternates(`/products/${handle}`),
    openGraph: images[0] ? { images: [{ url: images[0].url }] } : undefined,
  };
  // Portal-beheerbare override (meta-titel/omschrijving/noindex per pad).
  return applySeoOverride(meta, await getSeoOverride(`/products/${handle}`));
}

export default async function ProductPage({ params }: Props) {
  const { handle } = await params;
  const data = await getProductByHandle(handle);
  const locale = await getLocale();
  const t = await getT(locale);
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
    availableForSkus(variants.map((v) => v.sku).filter(Boolean)),
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

  const specs = SPEC_LABELS.map(([key, msgKey]) => ({
    label: t(msgKey),
    value: stripSymbols(String(attrs[key] ?? "")), // emoji's/symbolen weg uit SRS-waarden
  })).filter((s) => s.value);

  const hoofdgroep = String(attrs.hoofdgroep_omschrijving || "");
  // Brede/kleine accessoires (riem, das, strik, manchetknoop, pochet) passen niet
  // in de 4:5-tegel met object-cover → toon ze heel met object-contain.
  const fitContain = ["Riemen", "Stropdassen", "Strikken", "Manchetknopen", "Pochet", "Bretels", "Sjaals"].includes(hoofdgroep);
  const rating = parseRating(attrs);
  // Voorkeur: eigen categoriepagina (volledige listing) boven Shopify-collectie.
  const cat = categoryByHoofdgroep(hoofdgroep);
  const breadcrumb = cat
    ? { handle: `__cat__${cat.slug}`, title: cat.label }
    : collections.find((c) => !c.handle.includes("all-products")) ?? collections[0];
  const breadcrumbHref = cat
    ? `/categorie/${cat.slug}`
    : breadcrumb ? `/collections/${breadcrumb.handle}` : "";
  // getSessionCustomer (maat-voorselectie) + getSettings (look-config) zijn onafhankelijk
  // van de productdata → mee in de parallelle batch i.p.v. twee losse round-trips.
  const [recommendations, metafieldSiblings, variantSiblings, reviewSummary, productReviews, delivery, viewStats, reviewAi, contentOverride, blogPosts, sessionCustomer, settings] = await Promise.all([
    getRecommendations(hoofdgroep, product.id, 4),
    getColorSiblings(attrs, product.handle),
    getVariantSiblings(product.variantGroupKey || "", product.handle),
    getReviewSummary(product.handle),
    getPublishedReviews(product.handle, 30),
    representativeSku ? estimateDelivery([{ sku: representativeSku, qty: 1 }]) : Promise.resolve(null),
    getProductViewStats(product.handle),
    getCachedReviewAiSummary(product.handle),
    getProductContentOverride(product.handle),
    getBlogPostsForProduct(product.handle),
    getSessionCustomer(),
    getSettings(),
  ]);
  // Shop in jouw maat: voor ingelogde klanten de opgeslagen maat voorselecteren.
  const mySize = resolveMySize(hoofdgroep, sessionCustomer?.sizeProfile);
  // Portal-beheerbare AI-omschrijving heeft voorrang op de gesynchroniseerde tekst.
  const descriptionHtml = contentOverride?.descriptionHtml || product.descriptionHtml;
  // Eigen (native) reviews hebben voorrang op het legacy Judge.me-aggregaat.
  const displayRating = reviewSummary ? { value: reviewSummary.value, count: reviewSummary.count } : rating;
  // Shop de look op de AI-modelfoto: het canvas-model draagt een vaste outfit;
  // we maken die (samen met dit product) klikbaar/shoppbaar. (settings komt uit de
  // parallelle batch hierboven.)
  // MixMatch (USP): toon het samenstelbare pak — colbert + broek + gilet in dezelfde
  // stof — i.p.v. de generieke basis-outfit. Valt terug op de slimme look.
  const isMixMatch = String(attrs.mix_and_match || "") === "Ja" && ["Colberts", "Broeken", "Gilets"].includes(hoofdgroep);
  let modelLook: Awaited<ReturnType<typeof smartModelLook>> = null;
  if (isMixMatch && product.modelImageUrl) {
    const suit = await getSuitPieceHandles(product.handle).catch(() => null);
    if (suit) {
      const baseItems = settings.modelLook.items || [];
      const shirt = baseItems.find((i) => i.hoofdgroep === "Overhemden");
      const shoes = baseItems.find((i) => i.hoofdgroep === "Schoenen");
      modelLook = buildSuitLook({
        currentHandle: product.handle,
        modelImageUrl: product.modelImageUrl,
        colbertHandle: suit.colbert,
        broekHandle: suit.broek,
        giletHandle: suit.gilet,
        shirtHandle: shirt?.handle,
        shoesHandle: shoes?.handle,
      });
    }
  }
  if (!modelLook && product.modelImageUrl) {
    modelLook = await smartModelLook(
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
    );
  }
  const resolvedModelLook = modelLook ? await resolveLook(modelLook) : null;
  // Koopdata (maten/sku/voorraad) per look-item → inline maat kiezen + toevoegen.
  const lookBuy = resolvedModelLook
    ? await getLookBuyData(resolvedModelLook.products.filter((h) => h.product).map((h) => h.handle))
    : undefined;

  // Voorkeur: kleurvarianten uit de titel-groepering (dekt o.a. de 235 dassen-
  // /pochet-/strik-groepen); val terug op Shopify group_data-metafield. Daarna
  // op palet-volgorde sorteren (familie + licht→donker) i.p.v. alfabetisch.
  const colorSiblings = sortBySwatch(
    variantSiblings.length >= 2
      ? variantSiblings.map((s) => ({
          handle: s.handle,
          colorName: s.colorLabel,
          imageUrl: s.imageUrl,
          isCurrent: s.isCurrent,
          inStock: s.inStock,
        }))
      : metafieldSiblings,
  );

  const productJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: stripHtml(descriptionHtml).slice(0, 5000),
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
      // Prijsgeldigheid (voorkomt de veelvoorkomende GSC-waarschuwing "priceValidUntil").
      priceValidUntil: `${new Date().getFullYear() + 1}-12-31`,
      // Retourbeleid (rich results) — 14 dagen, NL, per post; kosten voor de klant tenzij
      // in de winkel / met GENTS-tegoed (bewust geen "gratis" claim in het algemene geval).
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: "NL",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 14,
        returnMethod: "https://schema.org/ReturnByMail",
        returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
      },
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
    ...(descriptionHtml
      ? [
          {
            title: t("pdp.accordion.description"),
            content: (
              <div
                className="max-w-none font-sans text-sm leading-relaxed text-ink-soft [&_a]:underline [&_h3]:mt-3 [&_h3]:font-medium [&_h3]:text-ink"
                dangerouslySetInnerHTML={{ __html: descriptionHtml }}
              />
            ),
          },
        ]
      : []),
    ...(composition.length || materiaal
      ? [{ title: t("pdp.material"), content: <MaterialBlock composition={composition} fallback={materiaal} /> }]
      : []),
    ...(careItems.length || careProseLines.length
      ? [{ title: t("pdp.accordion.care"), content: <CareBlock items={careItems} prose={careProseLines} /> }]
      : []),
    ...(specs.length
      ? [
          {
            title: t("pdp.accordion.specs"),
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
      title: t("pdp.accordion.returns"),
      content: (
        <div className="font-sans text-sm leading-relaxed text-ink-soft">
          <p>{t("pdp.returns.freeNote")}</p>
          <p className="mt-2">
            {t("pdp.accordion.deliveryContent2")}{" "}
            <Link href="/maatadvies" className="text-ink underline underline-offset-4">
              {t("pdp.accordion.deliveryLink")}
            </Link>{" "}
            {t("pdp.accordion.deliveryContent3")}
          </p>
        </div>
      ),
    },
    {
      title: t("pdp.accordion.faq"),
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
            // AI-beelden leiden de galerij ("model eerst"): modelpose 1 → modelpose 2
            // → detailfoto, daarna de echte productfoto's.
            ...(product.modelImageUrl ? [{ url: product.modelImageUrl, alt: product.modelImageAlt || product.title, contain: true }] : []),
            ...(product.modelImageUrl2 ? [{ url: product.modelImageUrl2, alt: product.modelImageAlt2 || product.title, contain: true }] : []),
            ...(product.detailImageUrl ? [{ url: product.detailImageUrl, alt: product.detailImageAlt || `${product.title} — detail` }] : []),
            ...images.map((i) => ({ url: i.url, alt: i.alt, contain: fitContain })),
          ]}
          title={product.title}
          sizeMedia={sizeMedia}
          video={product.modelVideoUrl || null}
          lookHref={resolvedModelLook && resolvedModelLook.products.some((h) => h.product) ? "#shop-de-look" : undefined}
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
            fitNote={String(attrs.pasvorm ?? "").trim() || null}
            freeShipThresholdCents={settings.freeShippingCents}
          />

          <SocialProof stats={viewStats} />

          <ul className="mt-8 space-y-1.5">
            {TRUST_KEYS.map((key) => (
              <li key={key} className="flex items-center gap-2 font-sans text-sm text-ink-soft">
                <svg aria-hidden className="h-4 w-4 shrink-0 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                {t(key)}
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

      {/* Sfeerbeeld — AI-lifestyle (model in setting), groot en ongecropt */}
      {product.lifestyleImageUrl ? (
        <section className="mt-20">
          <p className="label-brand">{t("pdp.lifestyle.eyebrow")}</p>
          <h2 className="mt-2 text-display-md">{t("pdp.lifestyle.title")}</h2>
          {/* Mobiel: swipe-rail (1 beeld in beeld) i.p.v. 3 gestapelde full-width
              beelden — scheelt ~2 schermen scrollen. Desktop: 3-koloms grid. */}
          <div
            tabIndex={0}
            role="region"
            aria-label={t("pdp.lifestyle.title")}
            className="mt-8 flex snap-x snap-mandatory gap-3 overflow-x-auto sm:grid sm:grid-cols-3 sm:overflow-visible"
          >
            {[product.lifestyleImageUrl, product.lifestyleImageUrl2, product.lifestyleImageUrl3].filter(Boolean).map((src, i) => (
              <div key={i} className="relative aspect-[2/3] w-[80%] shrink-0 snap-start overflow-hidden rounded-card bg-surface sm:w-auto">
                <Image src={src} alt={product.lifestyleImageAlt || product.title} fill sizes="(max-width: 768px) 80vw, 30vw" className="object-cover" />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Shop de look — de outfit van het model klikbaar/shoppbaar */}
      {resolvedModelLook && resolvedModelLook.products.some((h) => h.product) ? (
        <section id="shop-de-look" className="mt-20 scroll-mt-24">
          <p className="label-brand">{t("pdp.shopLook.eyebrow")}</p>
          <h2 className="mt-2 text-display-md">{t("pdp.shopLook.title")}</h2>
          <p className="mt-2 max-w-prose font-sans text-ink-soft">{t("pdp.look_instruction")}</p>
          <div className="mt-8">
            <ShopTheLook look={resolvedModelLook} aspectClass="aspect-[2/3]" buy={lookBuy} />
          </div>
        </section>
      ) : null}

      {/* Maak de look compleet — slimme bijverkoop */}
      {recommendations.length > 0 ? (
        <section className="mt-20">
          <p className="label-brand">{t("pdp.complementary.eyebrow")}</p>
          <h2 className="mt-2 text-display-md">{t("pdp.complementary.title")}</h2>
          {/* Mobiel: één swipe-rij i.p.v. een 2×2-blok — de derde shop-sectie op
              rij mag niet nóg twee schermen kosten. Desktop: 4-koloms grid. */}
          <div className="mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto sm:grid sm:grid-cols-4 sm:gap-x-4 sm:gap-y-8 sm:overflow-visible">
            {recommendations.map((p) => (
              <div key={p.id} className="w-[45%] shrink-0 snap-start sm:w-auto">
                <ProductCard product={p} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <AiReviewSummary summary={reviewAi} />

      <ReviewsSection handle={product.handle} summary={reviewSummary} reviews={productReviews} />

      {blogPosts.length > 0 ? (
        <section className="mt-20">
          <p className="label-brand">{t("pdp.blog.eyebrow")}</p>
          <h2 className="mt-2 text-display-md">{t("pdp.blog.title")}</h2>
          {/* Mobiel: swipe-rail — 3 gestapelde 4:5-kaarten waren ~2 schermen. */}
          <div className="mt-8 flex snap-x snap-mandatory gap-5 overflow-x-auto sm:grid sm:grid-cols-3 sm:overflow-visible">
            {blogPosts.map((b) => (
              <Link key={b.slug} href={`/blog/${b.slug}`} className="group block w-[70%] shrink-0 snap-start sm:w-auto">
                <div className="relative aspect-[4/5] overflow-hidden rounded-card bg-surface">
                  {b.heroImage ? (
                    <Image src={b.heroImage} alt={b.title} fill sizes="(max-width: 640px) 70vw, 30vw" className="object-cover transition-transform duration-500 ease-brand group-hover:scale-[1.04]" />
                  ) : null}
                </div>
                <p className="mt-2 label-brand !text-[0.62rem]">{b.occasion || t("pdp.blog.defaultLabel")}</p>
                <h3 className="mt-0.5 font-sans text-sm leading-snug text-ink group-hover:underline">{b.title}</h3>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <RecentStrip exclude={product.handle} />
    </div>
  );
}
