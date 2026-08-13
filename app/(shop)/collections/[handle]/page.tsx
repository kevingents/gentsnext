import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product-card";
import { TrackLijst } from "@/components/analytics/track-lijst";
import { PlpFilters } from "@/components/plp/filters";
import { SortSelect } from "@/components/plp/sort-select";
import { PlpActiveChips } from "@/components/plp/active-chips";
import { JsonLd } from "@/components/json-ld";
import { getCollectionByHandle, getFilteredProducts, getFacets, getCustomerTasteCats, isTechnicalCollection, handlesInStores, matenVoorHandles } from "@/lib/catalog";
import { parsePlpParams, selectionToFilters } from "@/lib/plp-params";
import { getSiteUrl } from "@/lib/site-url";
import { localeAlternates } from "@/lib/seo";
import { getLocale } from "@/lib/locale-server";
import { localizeFacets } from "@/lib/facet-i18n";
import { getT } from "@/lib/t-server";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { localizeCollectionText } from "@/lib/catalog-i18n";
import { getSessionCustomer } from "@/lib/account";
import { resolveMySize, mySizeBuckets } from "@/lib/size-match";
import { getMerchandisingPins } from "@/lib/merchandising";
import { getActieveRegels } from "@/lib/merchandising-regels";
import { plpStoreProps, storeFilterBranchIds } from "@/lib/plp-store";
import { resolveAb } from "@/lib/experiments";
import { TrackAb } from "@/components/analytics/track-ab";

export const dynamic = "force-dynamic";


function stripMetaHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
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
  const locale = await getLocale();
  const nl = locale === DEFAULT_LOCALE;
  const colTitle = await localizeCollectionText(locale, "ct", collection.handle, collection.title);
  const colDesc = await localizeCollectionText(locale, "cd", collection.handle, collection.descriptionHtml || "");
  return {
    title: (nl ? collection.seoTitle : "") || colTitle,
    description:
      (nl ? collection.seoDescription : "") ||
      stripMetaHtml(colDesc).slice(0, 160) ||
      `${colTitle} — GENTS`,
    // Technische app-collecties (XCloud/filter-index) nooit laten indexeren.
    ...(isTechnicalCollection(collection) ? { robots: { index: false, follow: false } } : {}),
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
  const locale = await getLocale();
  const t = await getT(locale);
  const collection = await getCollectionByHandle(handle);
  if (!collection) notFound();
  // Vertaalde collectie-titel/-omschrijving (ns ct/cd) — SEO voor /en /de.
  const colTitle = await localizeCollectionText(locale, "ct", collection.handle, collection.title);
  const colDesc = await localizeCollectionText(locale, "cd", collection.handle, collection.descriptionHtml || "");

  const filters = selectionToFilters(sel, {
    collectionId: collection.id,
    storeBranchIds: storeFilterBranchIds(sel.stores),
  });
  // Klant + facetten eerst — de klant voedt de "Aanbevolen"-ranking (maat + smaak).
  const [sessionCustomer, facets, ab] = await Promise.all([
    getSessionCustomer(),
    getFacets({ collectionId: collection.id }).then((fc) => localizeFacets(locale, fc)),
    // A/B: lijstpagina-experimenten mikken op de collectie-handle.
    resolveAb({ oppervlak: "plp", categorieen: [collection.handle] }),
  ]);
  const plpAb = ab.overrides.plp ?? {};
  // Sleutels voor merchandising-regels die aan één variant hangen. Ook een
  // geforceerde preview telt mee — anders kun je een variant-regelset nooit
  // bekijken zonder in de bucket te vallen.
  const abSleutels = ab.assignments.map((a) => `${a.id}:${a.variant}`.toLowerCase());
  const plpAbExposure = ab.assignments.filter((a) => !a.forced).map(({ id, variant }) => ({ id, variant }));
  // Variant-sortering wijkt alleen als de bezoeker zelf niets koos.
  const sort = !sel.sortExpliciet && plpAb.sortering ? plpAb.sortering : sel.sort;
  const perPagina = plpAb.perPagina ?? PER_PAGE;
  // Filters bovenaan = geen vaste zijkolom, dus ook geen tweekoloms raster.
  const bovenFilters = plpAb.filterPositie === "boven";
  // Winkelfilter: keuzelijst + telling voor de winkel die de klant nu ziet.
  const storeProps = await plpStoreProps(sel.stores, sessionCustomer?.preferences, {
    collectionId: collection.id,
  });
  // Shop in jouw maat: leid de categorie af uit de collectie-naam (gemengde
  // collecties matchen niet → geen chip).
  const my = resolveMySize(`${collection.handle} ${collection.title}`, sessionCustomer?.sizeProfile);
  // facet = maat mét matensysteem (`kl.M/L`, `sc.43`) — waar het maatfilter op
  // selecteert; row blijft de kale rij voor de ranking.
  const mySize = my ? { row: my.row, raw: my.raw, facet: my.facet } : null;
  // Gemengde collectie → boost op álle bewaarde maten (een schoen matcht nooit een
  // colbert-bucket, dus dat is veilig). Smaak + pins alleen op de default.
  const isDefault = sort === "aanbevolen";
  const [tasteCats, pinnedHandles, regels] = await Promise.all([
    isDefault && sessionCustomer?.id ? getCustomerTasteCats(sessionCustomer.id) : Promise.resolve([]),
    isDefault ? getMerchandisingPins("collection", handle) : Promise.resolve([]),
    isDefault ? getActieveRegels("collection", handle, abSleutels) : Promise.resolve([]),
  ]);
  const { items, total } = await getFilteredProducts(filters, sort, sel.page, perPagina, {
    mySizeRows: mySizeBuckets(sessionCustomer?.sizeProfile),
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
    return qs ? `/collections/${handle}?${qs}` : `/collections/${handle}`;
  }

  const siteUrl = getSiteUrl();
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: colTitle, item: `${siteUrl}/collections/${handle}` },
    ],
  };

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <JsonLd data={breadcrumbJsonLd} />
      {plpAbExposure.length > 0 ? <TrackAb assignments={plpAbExposure} /> : null}
      <nav className="font-sans text-sm text-muted" aria-label="Kruimelpad">
        <Link href="/" className="hover:text-ink">{t("common.home")}</Link>
        {" / "}
        <span className="text-ink">{colTitle}</span>
      </nav>
      {/* Mobiel compacter: eyebrow weg, en de (SEO-)beschrijving pas ónder het
          grid — vol uitgerold duwde die de producten van het scherm. */}
      <div className="mt-4 border-b border-line pb-4 sm:mt-6 sm:pb-6">
        <p className="label-brand hidden sm:block">{t("collection.header.eyebrow")}</p>
        <h1 className="text-display-md sm:mt-2">{colTitle}</h1>
        {collection.descriptionHtml ? (
          <div
            className="mt-2 hidden max-w-2xl font-sans text-sm text-ink-soft sm:block"
            dangerouslySetInnerHTML={{ __html: colDesc }}
          />
        ) : null}
      </div>

      <div className={`mt-8 grid gap-10 ${bovenFilters ? "" : "lg:grid-cols-[16rem_minmax(0,1fr)]"}`}>
        {/* Sidebar / mobiele drawer */}
        {/* Zie de categoriepagina: eigen schuifbalk, anders is het onderste deel
            van een lange filterlijst pas bereikbaar ná alle producten. */}
        <aside className={bovenFilters ? "" : "lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1"}>
          <PlpFilters facets={facets} selection={sel} total={total} mySize={mySize} sort={sort} positie={plpAb.filterPositie} storeOptions={filterProps.storeOptions} />
        </aside>

        {/* Grid */}
        <div>
          {/* Mobiel geen losse sorteer-rij — sorteren zit in de filter-drawer. */}
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
              <p>{t("collection.empty.title")}</p>
              <Link href={`/collections/${handle}`} className="mt-3 inline-block text-sm text-ink underline underline-offset-4">
                {t("collection.empty.clearFilters")}
              </Link>
            </div>
          ) : (
            <div className={`grid gap-x-4 gap-y-8 sm:grid-cols-3 ${plpAb.kolommenMobiel === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
              <TrackLijst producten={items} listId={`collection:${handle}`} listName={colTitle} />
              {items.map((product, i) => (
                <ProductCard key={product.id} product={product} priority={i < 8} position={(sel.page - 1) * perPagina + i + 1} listId={`collection:${handle}`} sort={sort} inMyStore={inMyStore.has(product.handle) ? storeLabel : null} beeld={plpAb.tegelBeeld} badges={plpAb.tegelBadges !== "uit"}
                  maten={maten?.get(product.handle)} />
              ))}
            </div>
          )}

          {totalPages > 1 ? (
            <nav className="mt-12 flex items-center justify-center gap-4 font-sans text-sm" aria-label={t("collection.pagination.aria")}>
              {sel.page > 1 ? (
                <Link className="btn-ghost !px-4 !py-3" href={pageHref(sel.page - 1)}>
                  {t("collection.pagination.previous")}
                </Link>
              ) : null}
              <span className="text-muted">
                {t("collection.pagination.pageLabel")} {sel.page} {t("collection.pagination.of")} {totalPages}
              </span>
              {sel.page < totalPages ? (
                <Link className="btn-ghost !px-4 !py-3" href={pageHref(sel.page + 1)}>
                  {t("collection.pagination.next")}
                </Link>
              ) : null}
            </nav>
          ) : null}

          {/* Mobiel: de collectie-beschrijving ónder de producten (boven het grid
              duwde die alles weg; de tekst blijft zo wel vindbaar + indexeerbaar). */}
          {collection.descriptionHtml ? (
            <div
              className="mt-10 border-t border-line pt-6 font-sans text-sm text-ink-soft sm:hidden"
              dangerouslySetInnerHTML={{ __html: colDesc }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
