import Image from "next/image";
import Link from "next/link";

/**
 * Visuele wrapper voor platte content-pagina's (migrated HTML / Sanity-tekst):
 * full-bleed hero met onderwerp-passende ECHTE merkfoto + nette prose + advies-CTA.
 * Zo wordt elke "kale tekstpagina" meteen een verzorgde, visuele pagina.
 */

// Onderwerp → echte merkfoto (geen AI). Eerste match wint; anders een nette default.
const HERO_BY_TOPIC: [RegExp, string][] = [
  [/trouw|bruiloft|huwelijk|wedding|getrouwd/i, "/brand/brand-impression-wedding.jpg"],
  [/uitvaart|rouw|condoleance|begrafenis|funeral/i, "/brand/brand-impression-funeral.jpg"],
  [/gala|black.?tie|smoking|rokkostuum|verenig|corps|student|diner/i, "/brand/brand-impression-gala.jpg"],
  [/zakelijk|business|sollicit|interview|werk|kantoor/i, "/brand/brand-impression-interview.jpg"],
];

export function heroForPage(handle: string, title: string): string {
  const t = `${handle} ${title}`;
  for (const [re, img] of HERO_BY_TOPIC) if (re.test(t)) return img;
  return "/brand/brand-model-charcoal.jpg";
}

export function ContentPage({
  title,
  image,
  eyebrow = "GENTS",
  children,
}: {
  title: string;
  image: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <article>
      {/* Hero */}
      <section className="relative h-[44vh] min-h-[300px] w-full overflow-hidden bg-ink">
        <Image src={image} alt={title} fill priority sizes="100vw" className="object-cover opacity-85" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/30 to-transparent" />
        <div className="absolute inset-0 mx-auto flex max-w-page flex-col items-start justify-end px-gutter pb-10">
          {eyebrow ? <p className="label-brand !text-canvas/80">{eyebrow}</p> : null}
          <h1 className="mt-2 max-w-3xl text-display-lg font-light text-canvas">{title}</h1>
        </div>
      </section>

      {/* Body */}
      <div className="mx-auto max-w-3xl px-gutter py-14">{children}</div>

      {/* Advies-CTA */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-page px-gutter py-12 text-center">
          <h2 className="text-display-md">Liever persoonlijk advies?</h2>
          <p className="mx-auto mt-3 max-w-xl font-sans text-ink-soft">
            Onze stylisten helpen je graag in één van onze 19 winkels — van de juiste maat tot het complete tenue voor jouw gelegenheid.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/pages/winkels" className="btn-primary">Vind een winkel</Link>
            <Link href="/maatadvies" className="btn-ghost">Maatadvies</Link>
          </div>
        </div>
      </section>
    </article>
  );
}
