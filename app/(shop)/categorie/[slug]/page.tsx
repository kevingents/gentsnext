import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product-card";
import { PlpFilters } from "@/components/plp/filters";
import { SortSelect } from "@/components/plp/sort-select";
import { JsonLd } from "@/components/json-ld";
import { getFilteredProducts, getFacets, getCustomerTasteCats } from "@/lib/catalog";
import { categoryBySlug } from "@/lib/categories";
import { parsePlpParams, selectionToFilters } from "@/lib/plp-params";
import { getSiteUrl } from "@/lib/site-url";
import { localeAlternates } from "@/lib/seo";
import { getSeoOverride, applySeoOverride } from "@/lib/seo-overrides";
import { getSessionCustomer } from "@/lib/account";
import { resolveMySize } from "@/lib/size-match";
import { getMerchandisingPins } from "@/lib/merchandising";

export const dynamic = "force-dynamic";

const PER_PAGE = 24;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const sel = parsePlpParams(await searchParams);
  const cat = categoryBySlug(slug);
  if (!cat) return {};
  const meta: Metadata = {
    title: cat.label,
    description: `${cat.label} bij GENTS — betaalbare luxe voor elk formeel moment.`,
    alternates: await localeAlternates(sel.page > 1 ? `/categorie/${slug}?page=${sel.page}` : `/categorie/${slug}`),
  };
  return applySeoOverride(meta, await getSeoOverride(`/categorie/${slug}`));
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const sel = parsePlpParams(sp);
  const cat = categoryBySlug(slug);
  if (!cat) notFound();

  const filters = selectionToFilters(sel, { category: cat.hoofdgroep });
  // Klant + facetten eerst — de klant voedt de "Aanbevolen"-ranking (maat + smaak).
  const [sessionCustomer, facets] = await Promise.all([
    getSessionCustomer(),
    getFacets({ category: cat.hoofdgroep }),
  ]);
  // Shop in jouw maat: bewaarde maat van de klant voor deze categorie.
  const my = resolveMySize(cat.hoofdgroep, sessionCustomer?.sizeProfile);
  const mySize = my ? { row: my.row, raw: my.raw } : null;
  // Personalisatie + merchandising-pins alleen op de default ("Aanbevolen").
  const isDefault = sel.sort === "aanbevolen";
  const [tasteCats, pinnedHandles] = await Promise.all([
    isDefault && sessionCustomer?.id ? getCustomerTasteCats(sessionCustomer.id) : Promise.resolve([]),
    isDefault ? getMerchandisingPins("categorie", slug) : Promise.resolve([]),
  ]);
  const { items, total } = await getFilteredProducts(filters, sel.sort, sel.page, PER_PAGE, {
    mySizeRows: my ? [my.row] : [],
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
    return qs ? `/categorie/${slug}?${qs}` : `/categorie/${slug}`;
  }

  const siteUrl = getSiteUrl();
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: cat.label, item: `${siteUrl}/categorie/${slug}` },
    ],
  };

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <JsonLd data={breadcrumbJsonLd} />
      <nav className="font-sans text-sm text-muted" aria-label="Kruimelpad">
        <Link href="/" className="hover:text-ink">Home</Link>
        {" / "}
        <span className="text-ink">{cat.label}</span>
      </nav>
      <div className="mt-6 border-b border-line pb-6">
        <p className="label-brand">Categorie</p>
        <h1 className="mt-2 text-display-md">{cat.label}</h1>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <PlpFilters facets={facets} selection={sel} total={total} mySize={mySize} />
        </aside>

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
              <Link href={`/categorie/${slug}`} className="mt-3 inline-block text-sm text-ink underline underline-offset-4">
                Wis alle filters
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3">
              {items.map((product) => (
                <ProductCard key={product.id} product={product} />
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
