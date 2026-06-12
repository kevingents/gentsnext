import Image from "next/image";
import Link from "next/link";
import { UspBar } from "@/components/usp-bar";
import { listCollections } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/** Gelegenheden — kern van de GENTS-positionering ("gelegenheid > doelgroep"). */
const OCCASIONS = [
  { label: "Bruiloft", img: "/brand/brand-impression-wedding.jpg", href: "/collections", keyword: "trouw" },
  { label: "Zakelijk", img: "/brand/brand-impression-interview.jpg", href: "/collections", keyword: "pak" },
  { label: "Gala & Black Tie", img: "/brand/brand-impression-gala.jpg", href: "/collections", keyword: "smoking" },
  { label: "Uitvaart", img: "/brand/brand-impression-funeral.jpg", href: "/collections", keyword: "" },
];

function findCollection(
  collections: { handle: string; title: string }[],
  keyword: string
): string {
  if (!keyword) return "/collections";
  const hit = collections.find(
    (c) =>
      c.handle.toLowerCase().includes(keyword) || c.title.toLowerCase().includes(keyword)
  );
  return hit ? `/collections/${hit.handle}` : "/collections";
}

export default async function Home() {
  let collections: Awaited<ReturnType<typeof listCollections>> = [];
  try {
    collections = await listCollections();
  } catch {
    // DB nog niet bereikbaar — hero + USP tonen, rest valt weg.
  }
  const featured = collections.slice(0, 8);

  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative isolate">
        <div className="relative h-[68vh] min-h-[460px] w-full overflow-hidden bg-ink">
          <Image
            src="/brand/brand-model-charcoal.jpg"
            alt="Man in charcoal kostuum"
            fill
            priority
            sizes="100vw"
            className="object-cover object-top opacity-90"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/10 to-transparent" />
          <div className="absolute inset-0 mx-auto flex max-w-page flex-col items-start justify-end px-gutter pb-14">
            <p className="label-brand !text-canvas/80">Suits You</p>
            <h1 className="mt-3 max-w-2xl text-display-xl font-light text-canvas">
              Perfect gekleed voor elk formeel moment
            </h1>
            <p className="mt-4 max-w-lg font-sans text-base text-canvas/85">
              Van bruiloft tot boardroom. Betaalbare luxe met persoonlijk advies van
              de dresscode-experts van GENTS.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/collections/pakken" className="btn-primary !bg-canvas !text-ink hover:!bg-surface">
                Shop pakken
              </Link>
              <Link href="/pak-samenstellen" className="btn-ghost !border-canvas !text-canvas hover:!bg-canvas hover:!text-ink">
                Stel je pak samen
              </Link>
            </div>
          </div>
        </div>
      </section>

      <UspBar />

      {/* ── Gelegenheden ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-page px-gutter py-16">
        <header className="mb-8 flex items-end justify-between">
          <div>
            <p className="label-brand">Voor elke gelegenheid</p>
            <h2 className="mt-2 text-display-md">Waar kleed je je voor?</h2>
          </div>
        </header>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {OCCASIONS.map((o) => (
            <Link
              key={o.label}
              href={findCollection(collections, o.keyword)}
              className="group relative aspect-[3/4] overflow-hidden rounded-card bg-surface"
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
          ))}
        </div>
      </section>

      {/* ── Pak samenstellen ──────────────────────────────────────────── */}
      <section className="bg-surface">
        <div className="mx-auto grid max-w-page items-center gap-10 px-gutter py-16 md:grid-cols-2">
          <div className="relative aspect-[4/3] overflow-hidden rounded-card">
            <Image
              src="/brand/brand-model-grey3piece.jpg"
              alt="Man in grijs three-piece kostuum"
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
          <div>
            <p className="label-brand">Op jouw maat</p>
            <h2 className="mt-2 text-display-md">Stel je eigen pak samen</h2>
            <p className="mt-4 max-w-md font-sans text-ink-soft">
              Kies je colbert en pantalon los — in de maat die jóú past, met of
              zonder gilet. Wij helpen je met onze maatadvies-tool aan de juiste
              maat per onderdeel.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/pak-samenstellen" className="btn-primary">
                Begin met samenstellen
              </Link>
              <Link href="/maatadvies" className="btn-ghost">
                Vind mijn maat
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Categorieën ───────────────────────────────────────────────── */}
      {featured.length > 0 ? (
        <section className="mx-auto max-w-page px-gutter py-16">
          <header className="mb-8">
            <p className="label-brand">Het assortiment</p>
            <h2 className="mt-2 text-display-md">Shop op categorie</h2>
          </header>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {featured.map((c) => (
              <Link
                key={c.id}
                href={`/collections/${c.handle}`}
                className="flex items-center justify-between border border-line bg-canvas px-5 py-4 font-sans text-sm transition-colors hover:border-ink"
              >
                <span>{c.title}</span>
                <span aria-hidden className="text-muted">→</span>
              </Link>
            ))}
          </div>
          <div className="mt-8">
            <Link href="/collections" className="font-sans text-sm text-ink underline underline-offset-4">
              Alle collecties bekijken
            </Link>
          </div>
        </section>
      ) : null}
    </>
  );
}
