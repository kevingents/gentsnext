import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product-card";
import { TrackLijst } from "@/components/analytics/track-lijst";
import { PlpFilters } from "@/components/plp/filters";
import { SortSelect } from "@/components/plp/sort-select";
import { PlpActiveChips } from "@/components/plp/active-chips";
import { JsonLd } from "@/components/json-ld";
import { getFilteredProducts, getFacets, getCustomerTasteCats, handlesInStores, matenVoorHandles } from "@/lib/catalog";
import { categoryBySlug } from "@/lib/categories";
import { parsePlpParams, selectionToFilters } from "@/lib/plp-params";
import { getSiteUrl } from "@/lib/site-url";
import { localeAlternates } from "@/lib/seo";
import { getLocale } from "@/lib/locale-server";
import { localizeFacets } from "@/lib/facet-i18n";
import { getT } from "@/lib/t-server";
import { getCategoryLabels } from "@/lib/nav-i18n";
import { getSeoOverride, applySeoOverride } from "@/lib/seo-overrides";
import { getSessionCustomer } from "@/lib/account";
import { resolveMySize } from "@/lib/size-match";
import { getMerchandisingPins } from "@/lib/merchandising";
import { getActieveRegels } from "@/lib/merchandising-regels";
import { plpStoreProps, storeFilterBranchIds } from "@/lib/plp-store";
import { resolveAb } from "@/lib/experiments";
import { TrackAb } from "@/components/analytics/track-ab";

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
  const locale = await getLocale();
  const t = await getT(locale);
  const cat = categoryBySlug(slug);
  if (!cat) notFound();
  // Vertaald categorie-label (ns "nav") voor kop + breadcrumb.
  const catLabel = (await getCategoryLabels(locale)).get(cat.slug) ?? cat.label;

  const filters = selectionToFilters(sel, {
    category: cat.hoofdgroep,
    storeBranchIds: storeFilterBranchIds(sel.stores),
  });
  // Klant + facetten eerst — de klant voedt de "Aanbevolen"-ranking (maat + smaak).
  const [sessionCustomer, facets, ab] = await Promise.all([
    getSessionCustomer(),
    getFacets({ category: cat.hoofdgroep }).then((fc) => localizeFacets(locale, fc)),
    // A/B: alleen "plp"-experimenten, eventueel beperkt tot bepaalde lijsten.
    resolveAb({ oppervlak: "plp", categorieen: [cat.slug, cat.hoofdgroep] }),
  ]);
  const plpAb = ab.overrides.plp ?? {};
  // Sleutels voor merchandising-regels die aan één variant hangen. Ook een
  // geforceerde preview telt mee — anders kun je een variant-regelset nooit
  // bekijken zonder in de bucket te vallen.
  const abSleutels = ab.assignments.map((a) => `${a.id}:${a.variant}`.toLowerCase());
  const plpAbExposure = ab.assignments.filter((a) => !a.forced).map(({ id, variant }) => ({ id, variant }));
  // Standaardsortering van de variant geldt alleen zolang de bezoeker zelf
  // niets koos. Alles hieronder rekent met déze sortering — óók de meting op
  // de tegel, anders staat er "aanbevolen" in de data terwijl de bezoeker
  // "nieuw" zag.
  const sort = !sel.sortExpliciet && plpAb.sortering ? plpAb.sortering : sel.sort;
  const perPagina = plpAb.perPagina ?? PER_PAGE;
  // Filters bovenaan = geen vaste zijkolom, dus ook geen tweekoloms raster.
  const bovenFilters = plpAb.filterPositie === "boven";
  // Winkelfilter: keuzelijst + telling voor de winkel die de klant nu ziet.
  const storeProps = await plpStoreProps(sel.stores, sessionCustomer?.preferences, {
    category: cat.hoofdgroep,
  });
  // Shop in jouw maat: bewaarde maat van de klant voor deze categorie.
  const my = resolveMySize(cat.hoofdgroep, sessionCustomer?.sizeProfile);
  // facet = maat mét matensysteem (`kl.M/L`, `sc.43`) — dat is de waarde waarop
  // het maatfilter selecteert; row blijft de kale rij voor de ranking.
  const mySize = my ? { row: my.row, raw: my.raw, facet: my.facet } : null;
  // Personalisatie + merchandising-pins alleen op de default ("Aanbevolen").
  const isDefault = sort === "aanbevolen";
  const [tasteCats, pinnedHandles, regels] = await Promise.all([
    isDefault && sessionCustomer?.id ? getCustomerTasteCats(sessionCustomer.id) : Promise.resolve([]),
    isDefault ? getMerchandisingPins("categorie", slug) : Promise.resolve([]),
    isDefault ? getActieveRegels("categorie", slug, abSleutels) : Promise.resolve([]),
  ]);
  const { items, total } = await getFilteredProducts(filters, sort, sel.page, perPagina, {
    mySizeRows: my ? [my.row] : [],
    tasteCats,
    pinnedHandles,
    regels,
  });
  const { myBranches, ...filterProps } = storeProps;
  /* "Ligt in jouw winkel" op de tegel: één query voor de hele pagina, dezelfde
     bron en regels als het filter. Zonder winkel geen query en geen label. */
  const inMyStore = myBranches.length
    ? await handlesInStores(items.map((p) => p.handle), myBranches.map((b) => b.branchId))
    : new Set<string>();
  /* Maten voor "snel toevoegen" — één query voor de hele pagina, en alleen als
     de variant erom vraagt. Zonder die voorwaarde betaalt iedereen de query
     voor een knop die niemand ziet. */
  const maten = plpAb.snelToevoegen === "aan" ? await matenVoorHandles(items.map((p) => p.handle)) : null;
  // Eén winkel? Dan de stad ("In Utrecht"). Meerdere: geen stad noemen, want dan
  // zouden we moeten zeggen wélke — en dat weet dit label niet.
  const storeLabel = myBranches.length === 1 ? myBranches[0].city : t("plp.card.inMyStoreGeneric");
  const totalPages = Math.max(1, Math.ceil(total / perPagina));

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
      {plpAbExposure.length > 0 ? <TrackAb assignments={plpAbExposure} /> : null}
      <nav className="font-sans text-sm text-muted" aria-label="Kruimelpad">
        <Link href="/" className="hover:text-ink">{t("common.home")}</Link>
        {" / "}
        <span className="text-ink">{catLabel}</span>
      </nav>
      {/* Mobiel compacter: eyebrow weg en minder witruimte — het eerste product
          stond anders pas op een halve viewport. */}
      <div className="mt-4 border-b border-line pb-4 sm:mt-6 sm:pb-6">
        <p className="label-brand hidden sm:block">{t("cat.header.eyebrow")}</p>
        <h1 className="text-display-md sm:mt-2">{catLabel}</h1>
      </div>

      <div className={`mt-8 grid gap-10 ${bovenFilters ? "" : "lg:grid-cols-[16rem_minmax(0,1fr)]"}`}>
        {/* Het filter scrolt mee tot het vastplakt, en krijgt daarna een eigen
            schuifbalk. Zonder die maximumhoogte bleef een lange filterlijst
            onderaan buiten beeld hangen: je kon er pas bij nadat je langs álle
            producten had gescrold. */}
        <aside className={bovenFilters ? "" : "lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1"}>
          <PlpFilters facets={facets} selection={sel} total={total} mySize={mySize} sort={sort} positie={plpAb.filterPositie} />
        </aside>

        <div>
          {/* Mobiel geen losse sorteer-rij: sorteren zit in de filter-drawer
              (knop + zwevende pil). Drie bedieningslagen was te druk. */}
          {/* Actieve persoonlijke filters (jouw maat / op voorraad in je winkel)
              als chips. Bewust BUITEN de lg-only sorteerregel: ook op een telefoon
              moet zichtbaar zijn dat je een deel van de lijst ziet. */}
          <PlpActiveChips
            selection={sel}
            mySize={mySize}
            mySizeCount={mySize ? (facets.sizes.find((x) => x.value === mySize.facet)?.count ?? null) : null}
            storeOptions={filterProps.storeOptions}
            myStoreTitles={filterProps.myStoreTitles}
          />
          <div className="mb-6 hidden items-center justify-between lg:flex">
            <span className="font-sans text-sm text-muted">{total} {t("plp.filters.itemPlural")}</span>
            <SortSelect value={sort} />
          </div>

          {items.length === 0 ? (
            <div className="py-16 text-center font-sans text-ink-soft">
              <p>{t("cat.empty.title")}</p>
              <Link href={`/categorie/${slug}`} className="mt-3 inline-block text-sm text-ink underline underline-offset-4">
                {t("cat.empty.clearFilters")}
              </Link>
            </div>
          ) : (
            <div className={`grid gap-x-4 gap-y-8 sm:grid-cols-3 ${plpAb.kolommenMobiel === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
              {/* De noemer onder de doorklikken: zonder view_item_list weet je
                  alleen wát er geklikt werd, niet wat er getóónd werd. */}
              <TrackLijst producten={items} listId={`categorie:${cat.slug}`} listName={catLabel} />
              {items.map((product, i) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  priority={i < 8}
                  position={(sel.page - 1) * perPagina + i + 1}
                  listId={`categorie:${cat.slug}`}
                  sort={sort}
                  inMyStore={inMyStore.has(product.handle) ? storeLabel : null}
                  beeld={plpAb.tegelBeeld}
                  badges={plpAb.tegelBadges !== "uit"}
                  maten={maten?.get(product.handle)}
                />
              ))}
            </div>
          )}

          {totalPages > 1 ? (
            <nav className="mt-12 flex items-center justify-center gap-4 font-sans text-sm" aria-label={t("cat.pagination.aria")}>
              {sel.page > 1 ? (
                <Link className="btn-ghost !px-4 !py-3" href={pageHref(sel.page - 1)}>
                  {t("cat.pagination.previous")}
                </Link>
              ) : null}
              <span className="text-muted">
                {t("cat.pagination.pageLabel")} {sel.page} {t("cat.pagination.of")} {totalPages}
              </span>
              {sel.page < totalPages ? (
                <Link className="btn-ghost !px-4 !py-3" href={pageHref(sel.page + 1)}>
                  {t("cat.pagination.next")}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
