import Image from "next/image";
import Link from "next/link";

/**
 * Zet platte migrated-content (h2 + p + lijst) automatisch om in een visuele
 * pagina: full-bleed hero + afwisselende beeld/tekst-secties met een icoon, een
 * accessoire-lijst als chips, en een "Hulp nodig"-blok als contact-box. Beelden
 * zijn ECHTE merkfoto's (geen AI). Werkt voor elke h2-gestructureerde tekstpagina.
 */

const ICONS = [
  "M7 4l2-2h6l2 2 3 3-3 3v10H7V10L4 7l3-3Z", // colbert
  "M12 9l4-3v6l-4-3-4 3V6l4 3Z", // strik
  "M12 4a2 2 0 0 0-1 3.7L4 13h16l-7-5.3A2 2 0 0 0 12 4Z", // hanger
  "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-4l2 3h-4l2-3Z", // ring
  "M20 8H4v12h16V8ZM9 8a3 3 0 0 1 6 0", // tas
  "M12 3l2.2 5.8L20 9l-4.5 4 1.4 6L12 16l-4.9 3 1.4-6L4 9l5.8-.2L12 3Z", // ster
];
const IMAGES = [
  "/brand/brand-model-navy.jpg",
  "/brand/brand-product-fabric.jpg",
  "/brand/brand-model-tuxedo.jpg",
  "/brand/brand-product-flatlay.jpg",
  "/brand/brand-model-grey3piece.jpg",
  "/brand/brand-product-lifestyle.jpg",
  "/brand/brand-model-charcoal.jpg",
];

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

type Section = { title: string; html: string; isHelp: boolean };

function parse(html: string): { intro: string; sections: Section[] } {
  const chunks = html.split(/<h2[^>]*>[\s\S]*?<\/h2>/i);
  const titles = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => stripTags(m[1]));
  const intro = stripTags(chunks[0] || "");
  const sections: Section[] = titles.map((t, i) => ({
    title: t,
    html: (chunks[i + 1] || "").trim(),
    isHelp: /hulp|advies|afspraak|contact|winkel/i.test(t),
  }));
  return { intro, sections };
}

export function RichArticle({ handle, title, html, heroImage }: { handle: string; title: string; html: string; heroImage: string }) {
  const { intro, sections } = parse(html);
  const body = sections.filter((s) => !s.isHelp);
  const help = sections.find((s) => s.isHelp);

  return (
    <article>
      {/* Hero */}
      <section className="relative h-[52vh] min-h-[360px] w-full overflow-hidden bg-ink">
        <Image src={heroImage} alt={title} fill priority sizes="100vw" className="object-cover opacity-85" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/30 to-transparent" />
        <div className="absolute inset-0 mx-auto flex max-w-page flex-col items-start justify-end px-gutter pb-12">
          <p className="label-brand !text-canvas/80">GENTS</p>
          <h1 className="mt-2 max-w-3xl text-display-xl font-light text-canvas">{title}</h1>
        </div>
      </section>

      {/* Intro */}
      {intro ? (
        <section className="mx-auto max-w-3xl px-gutter pt-14 text-center">
          <p className="font-sans text-lg leading-relaxed text-ink-soft">{intro}</p>
        </section>
      ) : null}

      {/* Secties — afwisselend beeld/tekst, met icoon */}
      <div className="mx-auto max-w-page px-gutter py-12">
        {body.map((s, i) => (
          <section key={s.title} className="grid items-center gap-8 border-t border-line py-12 first:border-t-0 md:grid-cols-2 md:gap-12">
            <div className={i % 2 === 1 ? "md:order-2" : ""}>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-ink">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={ICONS[i % ICONS.length]} />
                </svg>
              </span>
              <h2 className="mt-4 text-display-md">{s.title}</h2>
              <div className="rich-prose mt-3 font-sans leading-relaxed text-ink-soft" dangerouslySetInnerHTML={{ __html: s.html }} />
            </div>
            <div className={`relative aspect-[4/3] overflow-hidden rounded-card bg-surface ${i % 2 === 1 ? "md:order-1" : ""}`}>
              <Image src={IMAGES[i % IMAGES.length]} alt={s.title} fill sizes="(max-width:768px) 100vw, 45vw" className="object-cover" />
            </div>
          </section>
        ))}
      </div>

      {/* Hulp/contact-blok */}
      {help ? (
        <section className="bg-surface">
          <div className="mx-auto grid max-w-page items-center gap-8 px-gutter py-14 md:grid-cols-[1fr_1.2fr]">
            <div className="relative aspect-[4/3] overflow-hidden rounded-card bg-canvas">
              <Image src="/brand/brand-impression-interview.jpg" alt="Persoonlijk advies" fill sizes="(max-width:768px) 100vw, 40vw" className="object-cover" />
            </div>
            <div>
              <h2 className="text-display-md">{help.title}</h2>
              <div className="rich-prose mt-3 font-sans leading-relaxed text-ink-soft" dangerouslySetInnerHTML={{ __html: help.html }} />
              <Link href="/pages/winkels" className="btn-primary mt-6">Maak een afspraak</Link>
            </div>
          </div>
        </section>
      ) : null}

      {/* Advies-CTA */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-page px-gutter py-14 text-center">
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
