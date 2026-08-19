import Image from "next/image";
import { Link } from "@/components/i18n/link";
import { ProductCard } from "@/components/product-card";
import { Reveal } from "@/components/reveal";
import { ArrowRightIcon } from "@/components/icons";
import type { ProductCardData } from "@/lib/catalog";

/**
 * De blokken van de homepage, als presentatie-componenten. Ze krijgen alles
 * binnen via props: de pagina bepaalt (uit de portal-indeling) wélke blokken er
 * zijn en in welke volgorde, en lost de teksten op — een eigen tekst uit de
 * portal, of anders de ingebouwde vertaling. Zo blijft de taal-logica op één
 * plek en zijn deze componenten dom en makkelijk te herschikken.
 */

/** Kop boven een blok, met optioneel een link rechts (op mobiel verborgen). */
function Kop({
  eyebrow,
  titel,
  linkLabel,
  linkHref,
}: {
  eyebrow: string;
  titel: string;
  linkLabel?: string;
  linkHref?: string;
}) {
  const link = linkLabel && linkHref ? (
    <Link href={linkHref} className="hidden font-sans text-sm text-ink underline underline-offset-4 sm:inline">
      {linkLabel}
    </Link>
  ) : null;
  return (
    <header className={`mb-8 ${link ? "flex items-end justify-between" : ""}`}>
      <div>
        <p className="label-brand">{eyebrow}</p>
        <h2 className="mt-2 text-display-md">{titel}</h2>
      </div>
      {link}
    </header>
  );
}

/** Productstrip: "Populair nu", "Nieuw binnen — pakken", enz. */
export function ProductStrip({
  eyebrow,
  titel,
  linkLabel,
  linkHref,
  producten,
}: {
  eyebrow: string;
  titel: string;
  linkLabel?: string;
  linkHref?: string;
  producten: ProductCardData[];
}) {
  if (!producten.length) return null;
  return (
    <section className="mx-auto max-w-page px-gutter py-16">
      <Kop eyebrow={eyebrow} titel={titel} linkLabel={linkLabel} linkHref={linkHref} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
        {producten.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}

/** Gelegenheden-tegels — kern van de positionering ("gelegenheid > doelgroep"). */
export function OccasionTiles({
  eyebrow,
  titel,
  tegels,
}: {
  eyebrow: string;
  titel: string;
  tegels: { label: string; img: string; href: string }[];
}) {
  if (!tegels.length) return null;
  return (
    <section className="mx-auto max-w-page px-gutter py-16">
      <Kop eyebrow={eyebrow} titel={titel} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tegels.map((o, i) => (
          <Reveal key={`${o.label}-${i}`} delay={i * 90}>
            <Link
              href={o.href}
              className="group relative block aspect-[3/4] overflow-hidden rounded-card bg-surface"
            >
              <Image
                src={o.img}
                alt={o.label}
                fill
                sizes="(max-width: 1024px) 50vw, 25vw"
                className="object-cover transition duration-500 ease-brand group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/65 to-transparent" />
              <span className="absolute bottom-4 left-4 font-display text-xl font-light text-canvas">
                {o.label}
              </span>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/**
 * Contentbanner in twee stijlen. "licht" = beeld naast tekst op zandkleur
 * (zoals "Stel je eigen pak samen"); "donker" = full-bleed beeld met overlay
 * (zoals het etiquette-blok). Zonder afbeelding rendert 'ie niets — een banner
 * met een leeg beeldvlak ziet eruit als een storing.
 */
export function HomeBanner({
  stijl,
  afbeelding,
  afbeeldingAlt,
  eyebrow,
  titel,
  tekst,
  knopLabel,
  knopHref,
  knop2Label,
  knop2Href,
}: {
  stijl: "licht" | "donker";
  afbeelding: string;
  afbeeldingAlt: string;
  eyebrow: string;
  titel: string;
  tekst: string;
  knopLabel?: string;
  knopHref?: string;
  knop2Label?: string;
  knop2Href?: string;
}) {
  if (!afbeelding) return null;
  const knop1 = knopLabel && knopHref;
  const knop2 = knop2Label && knop2Href;

  if (stijl === "donker") {
    return (
      <section className="relative isolate overflow-hidden bg-ink text-canvas">
        <Image src={afbeelding} alt={afbeeldingAlt} fill sizes="100vw" className="object-cover opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/30" />
        <div className="relative mx-auto max-w-page px-gutter py-16">
          <p className="label-brand !text-canvas/70">{eyebrow}</p>
          <h2 className="mt-2 max-w-xl text-display-md !text-canvas">{titel}</h2>
          {tekst && <p className="mt-4 max-w-lg font-sans text-canvas/85">{tekst}</p>}
          {knop1 && (
            <Link href={knopHref!} className="btn-primary mt-7 !bg-canvas !text-ink hover:!bg-surface">
              {knopLabel}
            </Link>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="bg-surface">
      <div className="mx-auto grid max-w-page items-center gap-10 px-gutter py-16 md:grid-cols-2">
        <div className="relative aspect-[4/3] overflow-hidden rounded-card">
          <Image src={afbeelding} alt={afbeeldingAlt} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
        </div>
        <div>
          <p className="label-brand">{eyebrow}</p>
          <h2 className="mt-2 text-display-md">{titel}</h2>
          {tekst && <p className="mt-4 max-w-md font-sans text-ink-soft">{tekst}</p>}
          {(knop1 || knop2) && (
            <div className="mt-6 flex flex-wrap gap-3">
              {knop1 && <Link href={knopHref!} className="btn-primary">{knopLabel}</Link>}
              {knop2 && <Link href={knop2Href!} className="btn-ghost">{knop2Label}</Link>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Categorie-tegels (tekstlinks met pijl). */
export function CategoryTiles({
  eyebrow,
  titel,
  linkLabel,
  categorieen,
}: {
  eyebrow: string;
  titel: string;
  linkLabel: string;
  categorieen: { slug: string; label: string }[];
}) {
  if (!categorieen.length) return null;
  return (
    <section className="mx-auto max-w-page px-gutter py-16">
      <Kop eyebrow={eyebrow} titel={titel} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {categorieen.map((c) => (
          <Link
            key={c.slug}
            href={`/categorie/${c.slug}`}
            className="flex items-center justify-between border border-line bg-canvas px-5 py-4 font-sans text-sm transition-colors hover:border-ink"
          >
            <span>{c.label}</span>
            <ArrowRightIcon className="h-4 w-4 text-muted" />
          </Link>
        ))}
      </div>
      <div className="mt-8">
        <Link href="/collections" className="font-sans text-sm text-ink underline underline-offset-4">
          {linkLabel}
        </Link>
      </div>
    </section>
  );
}

/** Uitgelichte look ("Shop the look"). */
export function LookTeaser({
  eyebrow,
  titel,
  tekst,
  linkLabel,
  look,
}: {
  eyebrow: string;
  titel: string;
  tekst: string;
  linkLabel: string;
  look: { image: string; title: string } | null;
}) {
  if (!look) return null;
  return (
    <section className="relative my-4 overflow-hidden">
      <div className="mx-auto grid max-w-page items-center gap-8 px-gutter py-10 md:grid-cols-2">
        <div className="relative aspect-[4/5] overflow-hidden rounded-card bg-surface md:max-h-[520px]">
          <Image src={look.image} alt={look.title} fill sizes="(max-width:768px) 100vw, 50vw" className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/40 to-transparent" />
        </div>
        <div>
          <p className="label-brand">{eyebrow}</p>
          <h2 className="mt-2 text-display-md">{titel}</h2>
          {tekst && <p className="mt-3 max-w-md font-sans text-ink-soft">{tekst}</p>}
          <Link href="/looks" className="btn-primary mt-6 inline-flex">{linkLabel}</Link>
        </div>
      </div>
    </section>
  );
}
