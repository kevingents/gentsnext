import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product-card";
import { PlpFilters } from "@/components/plp/filters";
import { SortSelect } from "@/components/plp/sort-select";
import { JsonLd } from "@/components/json-ld";
import { getCollectionByHandle, getFilteredProducts, getFacets, getCustomerTasteCats } from "@/lib/catalog";
import { parsePlpParams, selectionToFilters } from "@/lib/plp-params";
import { getSiteUrl } from "@/lib/site-url";
import { localeAlternates } from "@/lib/seo";
import { getSessionCustomer } from "@/lib/account";
import { resolveMySize, mySizeBuckets } from "@/lib/size-match";
import { getMerchandisingPins } from "@/lib/merchandising";

export const dynamic = "force-dynamic";

const PER_PAGE = 24;

type Props = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { handle } = await params;
  const sel = parsePlpParams(await searchParams);
  const collection = await getCollectionByHandle(handle);
  if (!collection) return {};
  return {
    title: collection.seoTitle || collection.title,
    description:
      collection.seoDescription ||
      `${collection.title} bij GENTS — betaalbare luxe voor elk formeel moment.`,
    // Gefilterde/gepagineerde views niet als aparte canonical indexeren.
    alternates: await localeAlternates(
      sel.page > 1 ? `/collections/${handle}?page=${sel.page}` : `/collections/${handle}`,
    ),
  };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const { handle } = await params;
  const sp = await searchParams;
  const sel = parsePlpParams(sp);
  const collection = await getCollectionByHandle(handle);
  if (!collection) notFound();

  const filters = selectionToFilters(sel, { collectionId: collection.id });
  // Klant + facetten eerst — de klant voedt de "Aanbevolen"-ranking (maat + smaak).
  const [sessionCustomer, facets] = await Promise.all([
    getSessionCustomer(),
    getFacets({ collectionId: collection.id }),
  ]);
  // Shop in jouw maat: leid de categorie af uit de collectie-naam (gemengde
  // collecties matchen niet → geen chip).
  const my = resolveMySize(`${collection.handle} ${collection.title}`, sessionCustomer?.sizeProfile);
  const mySize = my ? { row: my.row, raw: my.raw } : null;
  // Gemengde collectie → boost op álle bewaarde maten (een schoen matcht nooit een
  // colbert-bucket, dus dat is veilig). Smaak + pins alleen op de default.
  const isDefault = sel.sort === "aanbevolen";
  const [tasteCats, pinnedHandles] = await Promise.all([
    isDefault && sessionCustomer?.id ? getCustomerTasteCats(sessionCustomer.id) : Promise.resolve([]),
    isDefault ? getMerchandisingPins("collection", handle) : Promise.resolve([]),
  ]);
  const { items, total } = await getFilteredProducts(filters, sel.sort, sel.page, PER_PAGE, {
    mySizeRows: mySizeBuckets(sessionCustomer?.sizeProfile),
    tasteCats,
    pinnedHandles,
  });
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === "string" && k !== "page") params.set(k, v);
    }
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/collections/${handle}?${qs}` : `/collections/${handle}`;
  }

  const siteUrl = getSiteUrl();
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: collection.title, item: `${siteUrl}/collections/${handle}` },
    ],
  };

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <JsonLd data={breadcrumbJsonLd} />
      <nav className="font-sans text-sm text-muted" aria-label="Kruimelpad">
        <Link href="/" className="hover:text-ink">Home</Link>
        {" / "}
        <span className="text-ink">{collection.title}</span>
      </nav>
      <div className="mt-6 border-b border-line pb-6">
        <p className="label-brand">Collectie</p>
        <h1 className="mt-2 text-display-md">{collection.title}</h1>
        {collection.descriptionHtml ? (
          <div
            className="mt-2 max-w-2xl font-sans text-sm text-ink-soft"
            dangerouslySetInnerHTML={{ __html: collection.descriptionHtml }}
          />
        ) : null}
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* Sidebar / mobiele drawer */}
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <PlpFilters facets={facets} selection={sel} total={total} mySize={mySize} />
        </aside>

        {/* Grid */}
        <div>
          <div className="mb-6 hidden items-center justify-between lg:flex">
            <span className="font-sans text-sm text-muted">{total} artikelen</span>
            <SortSelect value={sel.sort} />
          </div>
          <div className="mb-6 lg:hidden">
            <SortSelect value={sel.sort} />
          </div>

          {items.length === 0 ? (
            <div className="py-16 text-center font-sans text-ink-soft">
              <p>Geen artikelen gevonden met deze filters.</p>
              <Link href={`/collections/${handle}`} className="mt-3 inline-block text-sm text-ink underline underline-offset-4">
                Wis alle filters
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3">
              {items.map((product, i) => (
                <ProductCard key={product.id} product={product} priority={i < 8} />
              ))}
            </div>
          )}

          {totalPages > 1 ? (
            <nav className="mt-12 flex items-center justify-center gap-4 font-sans text-sm" aria-label="Paginering">
              {sel.page > 1 ? (
                <Link className="btn-ghost !px-4 !py-2" href={pageHref(sel.page - 1)}>
                  Vorige
                </Link>
              ) : null}
              <span className="text-muted">
                Pagina {sel.page} van {totalPages}
              </span>
              {sel.page < totalPages ? (
                <Link className="btn-ghost !px-4 !py-2" href={pageHref(sel.page + 1)}>
                  Volgende
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
