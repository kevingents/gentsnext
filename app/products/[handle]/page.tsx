import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { getProductByHandle } from "@/lib/catalog";
import { formatEuro, getReferencePrices } from "@/lib/pricing";
import { getSiteUrl } from "@/lib/site-url";
import { sortSizes } from "@/lib/sizing";
import { stockForSkus, stockAvailable } from "@/lib/stock";

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

  // Voorraad uit de SRS-export (voorkeur boven Shopify). Per maat tonen we of
  // hij leverbaar is; bij weinig voorraad een "laatste stuks"-hint.
  const [stockMap, hasStock] = await Promise.all([
    stockForSkus(variants.map((v) => v.sku).filter(Boolean)),
    stockAvailable(),
  ]);

  type SizeCell = { size: string; qty: number; known: boolean };
  // Maten gegroepeerd per kleur, in natuurlijke maatvolgorde, met voorraad.
  const sizesByColor = new Map<string, SizeCell[]>();
  for (const v of variants) {
    if (!v.size) continue;
    const color = v.color || "Standaard";
    const list = sizesByColor.get(color) || [];
    if (list.some((c) => c.size === v.size)) continue;
    const st = v.sku ? stockMap.get(v.sku) : undefined;
    list.push({ size: v.size, qty: st?.online ?? 0, known: hasStock && Boolean(v.sku) });
    sizesByColor.set(color, list);
  }
  for (const [color, cells] of sizesByColor) {
    sizesByColor.set(color, sortSizes(cells));
  }
  const anyInStock =
    !hasStock || [...sizesByColor.values()].some((cells) => cells.some((c) => !c.known || c.qty > 0));

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
      availability: anyInStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
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
    <div className="mx-auto max-w-page px-gutter py-10">
      <JsonLd data={productJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />

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
        {/* Afbeeldingen */}
        <div className="grid grid-cols-2 gap-3">
          {images.length ? (
            images.slice(0, 6).map((img, i) => (
              <div
                key={img.id}
                className={`relative overflow-hidden rounded-card bg-surface ${i === 0 ? "col-span-2 aspect-[4/5]" : "aspect-[3/4]"}`}
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
            <div className="col-span-2 flex aspect-[4/5] items-center justify-center rounded-card bg-surface font-sans text-sm text-muted">
              Geen afbeeldingen
            </div>
          )}
        </div>

        {/* Productinfo */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          {product.vendor ? <p className="label-brand">{product.vendor}</p> : null}
          <h1 className="mt-2 text-display-md">{product.title}</h1>

          <div className="mt-4 flex items-baseline gap-3">
            {referenceCents ? (
              <span className="font-sans text-lg text-muted line-through">
                {formatEuro(referenceCents)}
              </span>
            ) : null}
            <span className="font-display text-2xl">
              {minPrice !== maxPrice ? "vanaf " : ""}
              {formatEuro(minPrice)}
            </span>
          </div>
          {referenceCents ? (
            <p className="mt-1 font-sans text-xs text-muted">
              Doorgestreepte prijs: laagste prijs in de 30 dagen vóór de korting.
            </p>
          ) : null}

          <div className="mt-7 space-y-5">
            {[...sizesByColor.entries()].map(([color, cells]) => (
              <div key={color}>
                <div className="flex items-center justify-between">
                  <p className="font-sans text-sm font-medium">
                    {color}
                    {sizesByColor.size === 1 ? "" : ""}
                  </p>
                  <Link
                    href="/maatadvies"
                    className="font-sans text-xs text-ink underline underline-offset-4"
                  >
                    Vind mijn maat
                  </Link>
                </div>
                {cells.length ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {cells.map((cell) => {
                      const out = cell.known && cell.qty <= 0;
                      const low = cell.known && cell.qty > 0 && cell.qty <= 3;
                      return (
                        <li key={cell.size}>
                          <span
                            aria-disabled={out || undefined}
                            title={
                              out
                                ? "Niet op voorraad"
                                : low
                                  ? `Nog ${cell.qty} op voorraad`
                                  : undefined
                            }
                            className={`flex min-w-[3rem] flex-col items-center border px-3 py-2 text-center font-sans text-sm ${
                              out
                                ? "border-line text-muted line-through decoration-muted"
                                : "border-line text-ink hover:border-ink"
                            }`}
                          >
                            {cell.size}
                            {low ? (
                              <span className="mt-0.5 text-[0.6rem] not-italic text-danger no-underline">
                                nog {cell.qty}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>

          {hasStock ? (
            <p className="mt-4 font-sans text-xs text-muted">
              {anyInStock ? (
                <span className="text-success">● Op voorraad</span>
              ) : (
                <span>Tijdelijk uitverkocht — vraag naar beschikbaarheid in de winkel.</span>
              )}{" "}
              Voorraad op basis van onze winkel- en magazijnvoorraad (SRS).
            </p>
          ) : null}

          <button type="button" disabled className="btn-primary mt-6 w-full">
            Online bestellen volgt binnenkort
          </button>

          {product.descriptionHtml ? (
            <div
              className="mt-8 max-w-none font-sans text-sm leading-relaxed text-ink-soft [&_a]:underline [&_h3]:mt-4 [&_h3]:font-medium [&_h3]:text-ink"
              dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
            />
          ) : null}

          {specs.length ? (
            <section className="mt-8">
              <p className="label-brand">Specificaties</p>
              <dl className="mt-3 divide-y divide-line border-y border-line">
                {specs.map((spec) => (
                  <div key={spec.label} className="flex justify-between gap-4 py-2.5 font-sans text-sm">
                    <dt className="text-muted">{spec.label}</dt>
                    <dd className="text-right text-ink">{spec.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
