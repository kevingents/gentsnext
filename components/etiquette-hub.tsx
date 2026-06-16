import Image from "next/image";
import Link from "next/link";
import { ETIQUETTE } from "@/lib/etiquette-hub";

export function EtiquetteHub() {
  return (
    <>
      {/* Hero */}
      <section className="relative h-[50vh] min-h-[380px] w-full overflow-hidden bg-ink">
        <Image
          src="https://aokh8l4hrkrnedl2.public.blob.vercel-storage.com/ai-hero/landing-etiquette.jpg"
          alt="Etiquette & dresscodes"
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-85"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/75 via-ink/15 to-transparent" />
        <div className="absolute inset-0 mx-auto flex max-w-page flex-col items-start justify-end px-gutter pb-12">
          <p className="label-brand !text-canvas/80">De GENTS-gids</p>
          <h1 className="mt-2 max-w-3xl text-display-xl font-light text-canvas">
            Etiquette & dresscodes
          </h1>
        </div>
      </section>

      {/* Intro */}
      <section className="mx-auto max-w-3xl px-gutter py-12 text-center">
        <p className="font-sans text-lg leading-relaxed text-ink-soft">
          Van white tie tot smart casual — onze stylisten leggen elke dresscode
          uit, zodat je nooit hoeft te twijfelen wat je aantrekt. Verfijnde
          tradities, duidelijk uitgelegd.
        </p>
      </section>

      {/* Grid */}
      <section className="mx-auto max-w-page px-gutter pb-16">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ETIQUETTE.map((e) => (
            <Link
              key={e.handle}
              href={`/pages/${e.handle}`}
              className="group flex flex-col border border-line bg-canvas transition-colors hover:border-ink"
            >
              <div className="relative aspect-[4/5] overflow-hidden bg-surface">
                <Image
                  src={e.image}
                  alt={e.title}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                  className="object-cover transition duration-500 ease-brand group-hover:scale-[1.04]"
                />
              </div>
              <div className="flex flex-1 flex-col p-5">
                <h2 className="font-display text-lg">{e.title}</h2>
                <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">{e.description}</p>
                <span className="mt-auto pt-4 font-sans text-sm text-ink underline underline-offset-4">
                  Lees verder →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-ink text-canvas">
        <div className="mx-auto max-w-page px-gutter py-14 text-center">
          <h2 className="text-display-md !text-canvas">Hulp nodig?</h2>
          <p className="mx-auto mt-3 max-w-xl font-sans text-canvas/80">
            Onze stylisten in de winkel helpen je bij elke gelegenheid aan het
            juiste tenue.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/pages/winkels" className="btn-primary !bg-canvas !text-ink hover:!bg-surface">
              Vind een winkel
            </Link>
            <Link href="/collections/gala" className="btn-ghost !border-canvas !text-canvas hover:!bg-canvas hover:!text-ink">
              Shop gala & smoking
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
