import Image from "next/image";
import Link from "next/link";
import type { Landing } from "@/lib/landings";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/messages";

export async function LandingPage({ landing }: { landing: Landing }) {
  const locale = await getLocale();
  return (
    <article>
      {/* Hero */}
      <section className="relative h-[58vh] min-h-[420px] w-full overflow-hidden bg-ink">
        <Image
          src={landing.heroImage}
          alt={landing.title}
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-90"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/75 via-ink/15 to-transparent" />
        <div className="absolute inset-0 mx-auto flex max-w-page flex-col items-start justify-end px-gutter pb-12">
          <p className="label-brand !text-canvas/80">{landing.eyebrow}</p>
          <h1 className="mt-2 max-w-3xl text-display-xl font-light text-canvas">{landing.title}</h1>
        </div>
      </section>

      {/* Intro */}
      <section className="mx-auto max-w-3xl px-gutter py-14 text-center">
        <p className="font-sans text-lg leading-relaxed text-ink-soft">{landing.intro}</p>
        <Link href={landing.cta.href} className="btn-primary mt-8">
          {landing.cta.label}
        </Link>
      </section>

      {/* Secties: afwisselend beeld/tekst */}
      {landing.sections.map((s, i) => (
        <section key={s.title} className={i % 2 === 1 ? "bg-surface" : ""}>
          <div
            className={`mx-auto grid max-w-page items-center gap-10 px-gutter py-14 ${s.image ? "md:grid-cols-2" : "max-w-3xl"}`}
          >
            {s.image ? (
              <div className={`relative aspect-[4/3] overflow-hidden rounded-card ${i % 2 === 1 ? "md:order-2" : ""}`}>
                <Image src={s.image} alt={s.title} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
              </div>
            ) : null}
            <div>
              <h2 className="text-display-md">{s.title}</h2>
              <p className="mt-4 font-sans leading-relaxed text-ink-soft">{s.body}</p>
            </div>
          </div>
        </section>
      ))}

      {/* Shop-strip */}
      <section className="mx-auto max-w-page px-gutter py-14">
        <p className="label-brand">Shop deze gelegenheid</p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {landing.shop.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="flex items-center justify-between border border-line bg-canvas px-5 py-4 font-sans text-sm transition-colors hover:border-ink"
            >
              <span>{c.label}</span>
              <span aria-hidden className="text-muted">→</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Advies-CTA */}
      <section className="bg-ink text-canvas">
        <div className="mx-auto max-w-page px-gutter py-14 text-center">
          <h2 className="text-display-md !text-canvas">{t("landing.klantenservice.personalAdvice", locale)}</h2>
          <p className="mx-auto mt-3 max-w-xl font-sans text-canvas/80">
            Onze stylisten helpen je graag in één van onze 19 winkels — van de juiste
            maat tot het complete tenue voor jouw gelegenheid.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/pages/winkels" className="btn-primary !bg-canvas !text-ink hover:!bg-surface">
              {t("home.trustBlock.storesLink", locale)}
            </Link>
            <Link href="/maatadvies" className="btn-ghost !border-canvas !text-canvas hover:!bg-canvas hover:!text-ink">
              {t("nav.sizeAdvice", locale)}
            </Link>
          </div>
        </div>
      </section>
    </article>
  );
}
