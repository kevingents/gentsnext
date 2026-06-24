import Image from "next/image";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { ContactRequestForm } from "@/components/contact-request-form";
import type { ProductCardData } from "@/lib/catalog";
import { VISUAL } from "@/lib/visuals";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/messages";

type Props = {
  businessSuits: ProductCardData[];
  businessShirts: ProductCardData[];
};

export async function ZakelijkLanding({ businessSuits, businessShirts }: Props) {
  const locale = await getLocale();
  const USPS = [
    { title: t("landing.zakelijk.usp.stock.title", locale), body: t("landing.zakelijk.usp.stock.body", locale) },
    { title: t("landing.zakelijk.usp.stores.title", locale), body: t("landing.zakelijk.usp.stores.body", locale) },
    { title: t("landing.zakelijk.usp.branding.title", locale), body: t("landing.zakelijk.usp.branding.body", locale) },
    { title: t("landing.zakelijk.usp.contact.title", locale), body: t("landing.zakelijk.usp.contact.body", locale) },
  ];

  const SECTORS = [
    { name: t("landing.zakelijk.sector.horeca.name", locale), body: t("landing.zakelijk.sector.horeca.body", locale) },
    { name: t("landing.zakelijk.sector.retail.name", locale), body: t("landing.zakelijk.sector.retail.body", locale) },
    { name: t("landing.zakelijk.sector.office.name", locale), body: t("landing.zakelijk.sector.office.body", locale) },
    { name: t("landing.zakelijk.sector.events.name", locale), body: t("landing.zakelijk.sector.events.body", locale) },
  ];

  return (
    <article>
      {/* Hero */}
      <section className="relative h-[58vh] min-h-[420px] w-full overflow-hidden bg-ink">
        <Image
          src={VISUAL.zakelijk}
          alt={t("landing.zakelijk.label", locale)}
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-85"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent" />
        <div className="absolute inset-0 mx-auto flex max-w-page flex-col items-start justify-end px-gutter pb-14">
          <p className="label-brand !text-canvas/80">{t("landing.zakelijk.label", locale)}</p>
          <h1 className="mt-3 max-w-3xl text-display-xl font-light text-canvas">
            {t("landing.zakelijk.hero.title", locale)}
          </h1>
          <p className="mt-4 max-w-xl font-sans text-base text-canvas/85">
            {t("landing.zakelijk.hero.intro", locale)}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="#contact-zakelijk" className="btn-primary !bg-canvas !text-ink hover:!bg-surface">
              {t("landing.zakelijk.cta", locale)}
            </Link>
            <a
              href="tel:0851155042"
              className="btn-ghost !border-canvas !text-canvas hover:!bg-canvas hover:!text-ink"
            >
              {t("landing.zakelijk.callButton", locale, { phone: "085 115 50 42" })}
            </a>
          </div>
        </div>
      </section>

      {/* USPs */}
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-page gap-6 px-gutter py-10 sm:grid-cols-2 lg:grid-cols-4">
          {USPS.map((u) => (
            <div key={u.title} className="border-l border-line pl-4">
              <h2 className="font-display text-lg font-light">{u.title}</h2>
              <p className="mt-1.5 font-sans text-sm text-ink-soft">{u.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Voor wie */}
      <section className="mx-auto max-w-page px-gutter py-14">
        <p className="label-brand">{t("landing.zakelijk.forWho.eyebrow", locale)}</p>
        <h2 className="mt-2 text-display-md">{t("landing.zakelijk.forWho.title", locale)}</h2>
        <p className="mt-3 max-w-2xl font-sans text-ink-soft">
          {t("landing.zakelijk.forWho.body", locale)}
        </p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECTORS.map((s) => (
            <div key={s.name} className="border border-line p-5">
              <h3 className="font-display text-lg font-light">{s.name}</h3>
              <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Business pakken */}
      {businessSuits.length > 0 ? (
        <section className="mx-auto max-w-page px-gutter py-14">
          <header className="mb-8 flex items-end justify-between">
            <div>
              <p className="label-brand">{t("landing.zakelijk.suits.eyebrow", locale)}</p>
              <h2 className="mt-2 text-display-md">{t("landing.zakelijk.suits.title", locale)}</h2>
            </div>
            <Link href="/collections/mix-match-pakken" className="hidden font-sans text-sm text-ink underline underline-offset-4 sm:inline">
              {t("landing.zakelijk.suits.viewAll", locale)}
            </Link>
          </header>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
            {businessSuits.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}

      {businessShirts.length > 0 ? (
        <section className="bg-surface">
          <div className="mx-auto max-w-page px-gutter py-14">
            <header className="mb-8 flex items-end justify-between">
              <div>
                <p className="label-brand">{t("landing.zakelijk.shirts.eyebrow", locale)}</p>
                <h2 className="mt-2 text-display-md">{t("landing.zakelijk.shirts.title", locale)}</h2>
              </div>
              <Link href="/collections/business-overhemden" className="hidden font-sans text-sm text-ink underline underline-offset-4 sm:inline">
                {t("landing.zakelijk.shirts.viewAll", locale)}
              </Link>
            </header>
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
              {businessShirts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Contact + samenvatting */}
      <section className="mx-auto max-w-page px-gutter py-16">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="label-brand">{t("landing.howItWorks.eyebrow", locale)}</p>
            <h2 className="mt-2 text-display-md">{t("landing.zakelijk.steps.title", locale)}</h2>
            <ol className="mt-6 space-y-5">
              {[
                { n: "1", t: t("landing.zakelijk.step1.title", locale), b: t("landing.zakelijk.step1.body", locale) },
                { n: "2", t: t("landing.zakelijk.step2.title", locale), b: t("landing.zakelijk.step2.body", locale) },
                { n: "3", t: t("landing.zakelijk.step3.title", locale), b: t("landing.zakelijk.step3.body", locale) },
              ].map((s) => (
                <li key={s.n} className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-ink font-display text-lg">{s.n}</span>
                  <div>
                    <h3 className="font-display text-lg font-light">{s.t}</h3>
                    <p className="mt-1 font-sans text-sm text-ink-soft">{s.b}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <ContactRequestForm
            channel="zakelijk"
            title={t("landing.zakelijk.cta", locale)}
            intro={t("landing.zakelijk.formIntro", locale)}
            showOrg
            showGroupSize
          />
        </div>
      </section>
    </article>
  );
}
