import Image from "next/image";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { ContactRequestForm } from "@/components/contact-request-form";
import type { ProductCardData } from "@/lib/catalog";

const USPS = [
  { title: "Specialist in rokkostuums & smokings", body: "Voor gala's, corpsactiviteiten en diners waar uitstraling telt." },
  { title: "Op voorraad & snel leverbaar", body: "Ideaal wanneer kleding op korte termijn nodig is voor een bestuursoverdracht of gala." },
  { title: "Sponsoring & pasdagen", body: "We organiseren pasmomenten op locatie voor jaarclubs, disputen en commissies." },
  { title: "Personalisatie mogelijk", body: "Dassen, kleding en accessoires met logo, embleem of borduring." },
];

const ITEMS = [
  { n: "01", t: "Rokkostuums & smokings", b: "Voor gala's, corpsactiviteiten en diners waar dresscode belangrijk is." },
  { n: "02", t: "Bestuurspakken", b: "Voor besturen en commissies die als groep een uniforme, representatieve uitstraling willen." },
  { n: "03", t: "Kroegjasjes", b: "Een herkenbaar studentproduct met karakter, stijl en uitstraling." },
  { n: "04", t: "Dassen & personalisatie", b: "Met logo, embleem of borduring voor vereniging, commissie of bestuur." },
];

type Props = {
  highlights: ProductCardData[];
};

export function StudentsLanding({ highlights }: Props) {
  return (
    <article>
      {/* Hero */}
      <section className="relative h-[60vh] min-h-[440px] w-full overflow-hidden bg-ink">
        <Image
          src="https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-hero/landing-students.jpg"
          alt="GENTS Students"
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-85"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent" />
        <div className="absolute inset-0 mx-auto flex max-w-page flex-col items-start justify-end px-gutter pb-14">
          <p className="label-brand !text-canvas/80">GENTS Students</p>
          <h1 className="mt-3 max-w-3xl text-display-xl font-light text-canvas">
            Dé specialist in rokkostuums, bestuurspakken en studentenkleding
          </h1>
          <p className="mt-4 max-w-xl font-sans text-base text-canvas/85">
            Voor verenigingen, besturen en studenten die goed voor de dag willen
            komen — snel, stijlvol en betaalbaar.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="#contact-students" className="btn-primary !bg-canvas !text-ink hover:!bg-surface">
              Vraag direct informatie aan
            </Link>
            <a
              href="https://wa.me/31851155042"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost !border-canvas !text-canvas hover:!bg-canvas hover:!text-ink"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M17.5 14.4l-2.5-1.3-.6.7c-.6.7-1.4.8-2.3.3-1.5-.8-3-2.2-3.8-3.7-.5-.9-.3-1.7.3-2.3l.7-.7-1.2-2.5c-.2-.4-.6-.6-1-.4-.8.3-1.6 1-2 1.7-.7 1.2-.4 3 1 5.6 1.4 2.6 4.3 5.5 6.9 6.9 2.6 1.4 4.4 1.7 5.6 1 .7-.4 1.3-1.2 1.7-2 .1-.4-.1-.8-.5-1zM12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.7 1.4 5.2L2 22l4.9-1.3C8.4 21.5 10.1 22 12 22c5.5 0 10-4.5 10-10S17.5 2 12 2z" />
              </svg>
              WhatsApp ons
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

      {/* Wat we aanbieden */}
      <section className="mx-auto max-w-page px-gutter py-14">
        <p className="label-brand">Wat we aanbieden</p>
        <h2 className="mt-2 text-display-md">Voor elk formeel studentmoment de juiste outfit</h2>
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((i) => (
            <div key={i.n} className="border border-line p-5">
              <p className="font-display text-xs tracking-widest text-muted">{i.n}</p>
              <h3 className="mt-2 font-display text-lg font-light">{i.t}</h3>
              <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">{i.b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Shop-strips */}
      <section className="bg-surface">
        <div className="mx-auto max-w-page px-gutter py-14">
          <p className="label-brand">Shop direct</p>
          <h2 className="mt-2 text-display-md">Voor gala, bestuur en vereniging</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Rokkostuums", href: "/collections/rokkostuum" },
              { label: "Smoking", href: "/collections/smoking" },
              { label: "Jacquets", href: "/collections/jacquets" },
              { label: "Kroegjasjes", href: "/collections/kroegjasjes" },
            ].map((c) => (
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
        </div>
      </section>

      {highlights.length > 0 ? (
        <section className="mx-auto max-w-page px-gutter py-14">
          <header className="mb-8 flex items-end justify-between">
            <div>
              <p className="label-brand">Onze galakleding</p>
              <h2 className="mt-2 text-display-md">Klaar voor je formele moment</h2>
            </div>
            <Link href="/collections/gala" className="hidden font-sans text-sm text-ink underline underline-offset-4 sm:inline">
              Alle gala & smoking
            </Link>
          </header>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
            {highlights.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Stappen + contact */}
      <section className="mx-auto max-w-page px-gutter py-16">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="label-brand">Zo werkt het</p>
            <h2 className="mt-2 text-display-md">Van eerste contact tot complete groep in pak</h2>
            <ol className="mt-6 space-y-5">
              {[
                { n: "1", t: "Vertel wat jullie nodig hebben", b: "Aantal personen, type kleding, gewenste stijl en wanneer het nodig is." },
                { n: "2", t: "Wij adviseren over de beste aanpak", b: "We denken mee over sponsoring, pasdagen, maten, voorraad en levering." },
                { n: "3", t: "Passen en aanleveren", b: "In een van onze 19 winkels of als groep op één vast moment. Vermaak waar nodig." },
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
            channel="students"
            title="Vraag direct informatie aan"
            intro="Voor besturen, verenigingen of individuele studenten. We reageren binnen één werkdag."
            showOrg
            showGroupSize
            showDate
          />
        </div>
      </section>
    </article>
  );
}
