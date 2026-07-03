import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { getOccasions } from "@/lib/occasions-server";
import { getSiteUrl } from "@/lib/site-url";
import { localeAlternates } from "@/lib/seo";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Gelegenheden — kleding voor elk moment",
    description: "Bruiloft, gala, zakelijk of een afscheid — vind bij GENTS de juiste outfit voor elke gelegenheid, met persoonlijk advies.",
    alternates: await localeAlternates("/gelegenheden"),
  };
}

export default async function GelegenhedenPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const occasions = await getOccasions();
  const siteUrl = getSiteUrl();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: "Gelegenheden", item: `${siteUrl}/gelegenheden` },
    ],
  };

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <JsonLd data={jsonLd} />
      <nav className="font-sans text-sm text-muted" aria-label={t("common.breadcrumb")}>
        <Link href="/" className="hover:text-ink">{t("common.home")}</Link>
        {" / "}
        <span className="text-ink">{t("occasions.label")}</span>
      </nav>

      <div className="mt-6 max-w-2xl">
        <p className="label-brand">{t("occasions.label")}</p>
        <h1 className="mt-2 text-display-lg">{t("occasions.title")}</h1>
        <p className="mt-4 font-sans text-ink-soft">
          {t("occasions.intro")}
        </p>
      </div>

      <div className="mt-10 grid gap-8 sm:grid-cols-2">
        {occasions.map((o) => (
          <article key={o.slug} className="group flex flex-col overflow-hidden border border-line bg-canvas">
            <Link href={o.ctaHref} className="relative block aspect-[4/3] overflow-hidden bg-surface">
              {o.image ? (
                <Image
                  src={o.image}
                  alt={o.title}
                  fill
                  sizes="(min-width: 640px) 50vw, 100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
              ) : null}
            </Link>
            <div className="flex flex-1 flex-col p-6">
              {o.eyebrow ? <p className="label-brand">{o.eyebrow}</p> : null}
              <h2 className="mt-2 font-display text-2xl font-light text-ink">{o.title}</h2>
              {o.intro ? <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">{o.intro}</p> : null}

              {o.links.length ? (
                <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
                  {o.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="font-sans text-sm text-ink-soft underline underline-offset-4 hover:text-ink">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-5 pt-1">
                <Link href={o.ctaHref} className="btn-primary">{o.ctaLabel}</Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
