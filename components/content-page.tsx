import Image from "next/image";
import Link from "next/link";
import { heroVisualFor } from "@/lib/visuals";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/messages";

/**
 * Visuele wrapper voor platte content-pagina's (migrated HTML / Sanity-tekst):
 * full-bleed hero met een onderwerp-passend ECHT-PRODUCT-beeld (FASHN) + nette
 * prose + advies-CTA. Geen stock/FAL — altijd onze eigen producten.
 */

/** Onderwerp → passend echt-product-bannerbeeld (FASHN). */
export function heroForPage(handle: string, title: string): string {
  return heroVisualFor(`${handle} ${title}`);
}

export async function ContentPage({
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
  const locale = await getLocale();
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
          <h2 className="text-display-md">{t("landing.klantenservice.personalAdvice", locale)}</h2>
          <p className="mx-auto mt-3 max-w-xl font-sans text-ink-soft">
            Onze stylisten helpen je graag in één van onze 19 winkels — van de juiste maat tot het complete tenue voor jouw gelegenheid.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/pages/winkels" className="btn-primary">{t("order.find_store", locale)}</Link>
            <Link href="/maatadvies" className="btn-ghost">{t("help.link.sizeAdvice", locale)}</Link>
          </div>
        </div>
      </section>
    </article>
  );
}
