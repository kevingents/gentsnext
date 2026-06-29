import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { SizeTable } from "@/components/maattabellen/size-table";
import { localeAlternates } from "@/lib/seo";
import { getSeoOverride, applySeoOverride } from "@/lib/seo-overrides";
import { getSiteUrl } from "@/lib/site-url";
import { categoryBySlug } from "@/lib/categories";
import { SIZE_GUIDES, guideBySlug, MEASURE_INFO } from "@/lib/size-chart-hub";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return SIZE_GUIDES.map((g) => ({ slug: g.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) return {};
  const meta: Metadata = {
    title: guide.seoTitle,
    description: guide.seoDescription,
    alternates: await localeAlternates(`/maattabellen/${slug}`),
  };
  return applySeoOverride(meta, await getSeoOverride(`/maattabellen/${slug}`));
}

export default async function MaattabelPage({ params }: Props) {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) notFound();

  const siteUrl = getSiteUrl();
  const cat = guide.categorySlug ? categoryBySlug(guide.categorySlug) : null;
  const related = SIZE_GUIDES.filter((g) => g.slug !== guide.slug);

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: "Maattabellen", item: `${siteUrl}/maattabellen` },
      { "@type": "ListItem", position: 3, name: guide.title, item: `${siteUrl}/maattabellen/${guide.slug}` },
    ],
  };
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: guide.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="mx-auto max-w-3xl px-gutter py-10">
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={faqJsonLd} />

      <nav className="font-sans text-sm text-muted" aria-label="Kruimelpad">
        <Link href="/" className="hover:text-ink">Home</Link>
        {" / "}
        <Link href="/maattabellen" className="hover:text-ink">Maattabellen</Link>
        {" / "}
        <span className="text-ink">{guide.navLabel}</span>
      </nav>

      <header className="mt-6">
        <p className="label-brand">Maattabel</p>
        <h1 className="mt-2 text-display-lg">{guide.title}</h1>
        <p className="mt-4 font-sans text-ink-soft">{guide.intro}</p>
      </header>

      {/* tabellen */}
      <div className="mt-8 space-y-8">
        {guide.charts.map((spec, i) => (
          <SizeTable key={i} spec={spec} />
        ))}
      </div>

      {/* CTA's */}
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/maatadvies" className="btn-primary">Vind mijn maat</Link>
        {cat ? (
          <Link href={`/categorie/${cat.slug}`} className="btn-ghost">Bekijk alle {cat.label.toLowerCase()}</Link>
        ) : null}
      </div>

      {/* zo meet je jezelf op */}
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-display-md">Zo meet je jezelf op</h2>
        <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {guide.measures.map((m) => (
            <div key={m}>
              <p className="font-display text-base text-ink">{MEASURE_INFO[m].label}</p>
              <p className="mt-1 font-sans text-sm text-ink-soft">{MEASURE_INFO[m].how}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 font-sans text-sm text-muted">
          Tip: meet over je ondergoed of een dun shirt en houd het meetlint recht en niet te strak.
        </p>
      </section>

      {/* veelgestelde vragen */}
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-display-md">Veelgestelde vragen</h2>
        <dl className="mt-5 divide-y divide-line">
          {guide.faqs.map((f) => (
            <div key={f.q} className="py-4">
              <dt className="font-display text-base text-ink">{f.q}</dt>
              <dd className="mt-1.5 font-sans text-sm text-ink-soft">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* andere maattabellen */}
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="font-display text-lg text-ink">Andere maattabellen</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {related.map((g) => (
            <Link
              key={g.slug}
              href={`/maattabellen/${g.slug}`}
              className="rounded-full border border-line px-4 py-1.5 font-sans text-sm text-ink-soft transition hover:border-ink/40 hover:text-ink"
            >
              {g.navLabel}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
