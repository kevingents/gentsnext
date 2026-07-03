import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { localeAlternates } from "@/lib/seo";
import { getSeoOverride, applySeoOverride } from "@/lib/seo-overrides";
import { getSiteUrl } from "@/lib/site-url";
import { SIZE_GUIDES, MEASURE_INFO, type Measure } from "@/lib/size-chart-hub";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const meta: Metadata = {
    title: "Maattabellen — vind je maat per categorie",
    description:
      "Alle GENTS-maattabellen op één plek: pakken, colberts, overhemden, pantalons, gilets, truien en poloshirts. Lichaamsmaten in centimeters per maat.",
    alternates: await localeAlternates("/maattabellen"),
  };
  return applySeoOverride(meta, await getSeoOverride("/maattabellen"));
}

const ALL_MEASURES: Measure[] = ["chest", "waist", "collar", "inseam"];

export default async function MaattabellenHubPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const siteUrl = getSiteUrl();
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: "Maattabellen", item: `${siteUrl}/maattabellen` },
    ],
  };
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: SIZE_GUIDES.map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: g.title,
      url: `${siteUrl}/maattabellen/${g.slug}`,
    })),
  };

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={itemListJsonLd} />

      <nav className="font-sans text-sm text-muted" aria-label={t("common.breadcrumb")}>
        <Link href="/" className="hover:text-ink">{t("common.home")}</Link>
        {" / "}
        <span className="text-ink">{t("maattabellen.title")}</span>
      </nav>

      <header className="mt-6 max-w-2xl">
        <p className="label-brand">{t("maattabellen.eyebrow")}</p>
        <h1 className="mt-2 text-display-lg">{t("maattabellen.title")}</h1>
        <p className="mt-4 font-sans text-ink-soft">
          {t("maattabellen.intro")}{" "}
          <Link href="/maatadvies" className="text-ink underline underline-offset-4">{t("maattabellen.intro.linkAdvice")}</Link>.
        </p>
      </header>

      {/* categorie-kaarten */}
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SIZE_GUIDES.map((g) => (
          <Link
            key={g.slug}
            href={`/maattabellen/${g.slug}`}
            className="group flex flex-col justify-between rounded-lg border border-line bg-canvas p-5 transition hover:border-ink/40 hover:shadow-sm"
          >
            <div>
              <h2 className="font-display text-lg text-ink">{g.navLabel}</h2>
              <p className="mt-1 font-sans text-sm text-ink-soft">{g.cardDescription}</p>
            </div>
            <span className="mt-4 font-sans text-sm text-ink underline underline-offset-4 group-hover:no-underline">
              {t("maattabellen.card.view")} →
            </span>
          </Link>
        ))}
      </div>

      {/* zo meet je jezelf op */}
      <section className="mt-14 border-t border-line pt-10">
        <h2 className="text-display-md">{t("maattabellen.measure.title")}</h2>
        <p className="mt-2 max-w-xl font-sans text-ink-soft">
          {t("maattabellen.measure.intro")}
        </p>
        <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {ALL_MEASURES.map((m) => (
            <div key={m}>
              <p className="font-display text-base text-ink">{MEASURE_INFO[m].label}</p>
              <p className="mt-1 font-sans text-sm text-ink-soft">{MEASURE_INFO[m].how}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-12 rounded-lg border border-line bg-surface px-6 py-6 text-center">
        <p className="font-display text-lg text-ink">{t("maattabellen.cta.title")}</p>
        <p className="mt-1 font-sans text-sm text-ink-soft">
          {t("maattabellen.cta.body")}
        </p>
        <Link href="/maatadvies" className="btn-primary mt-4 inline-block">{t("nav.sizeAdvisor")}</Link>
      </div>
    </div>
  );
}
