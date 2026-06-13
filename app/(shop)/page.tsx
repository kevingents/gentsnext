import Image from "next/image";
import Link from "next/link";
import { UspBar } from "@/components/usp-bar";
import { ProductCard } from "@/components/product-card";
import { RecentStrip } from "@/components/recent/recent-strip";
import { TrustBlock } from "@/components/home/trust-block";
import { JsonLd } from "@/components/json-ld";
import { getStores } from "@/lib/stores";
import { getSiteUrl } from "@/lib/site-url";
import { listCollections, getHighlights } from "@/lib/catalog";
import { CATEGORIES } from "@/lib/categories";

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
  let pakHighlights: Awaited<ReturnType<typeof getHighlights>> = [];
  let overhemdHighlights: Awaited<ReturnType<typeof getHighlights>> = [];
  try {
    [collections, pakHighlights, overhemdHighlights] = await Promise.all([
      listCollections(),
      getHighlights("Pakken", 4),
      getHighlights("Overhemden", 4),
    ]);
  } catch {
    // DB nog niet bereikbaar — hero + USP tonen, rest valt weg.
  }
  const featured = CATEGORIES.slice(0, 8);
  const siteUrl = getSiteUrl();
  const stores = getStores();
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "ClothingStore",
    name: "GENTS Herenmode",
    url: siteUrl,
    logo: `${siteUrl}/brand/brand-logo-zwart.png`,
    image: `${siteUrl}/brand/brand-model-charcoal.jpg`,
    slogan: "Suits You",
    description: "GENTS — dé specialist voor je formele momenten. Pakken, overhemden, smoking en accessoires.",
    department: stores.slice(0, 20).map((s) => ({
      "@type": "ClothingStore",
      name: `GENTS ${s.city}`,
      url: `${siteUrl}/pages/${s.pageHandle}`,
      address: { "@type": "PostalAddress", streetAddress: s.address, addressLocality: s.city, addressCountry: "NL" },
      telephone: s.phone || undefined,
    })),
  };

  return (
    <>
      <JsonLd data={orgJsonLd} />
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
              <Link href="/categorie/pakken" className="btn-primary !bg-canvas !text-ink hover:!bg-surface">
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

      {/* ── Strip: Pakken (nieuwste) ────────────────────────────────────── */}
      {pakHighlights.length > 0 ? (
        <section className="mx-auto max-w-page px-gutter py-16">
          <header className="mb-8 flex items-end justify-between">
            <div>
              <p className="label-brand">Pakken</p>
              <h2 className="mt-2 text-display-md">Nieuw binnen</h2>
            </div>
            <Link href="/collections/pakken" className="hidden font-sans text-sm text-ink underline underline-offset-4 sm:inline">
              Alle pakken bekijken
            </Link>
          </header>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
            {pakHighlights.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}

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

      {/* ── Strip: Overhemden ─────────────────────────────────────────── */}
      {overhemdHighlights.length > 0 ? (
        <section className="mx-auto max-w-page px-gutter py-16">
          <header className="mb-8 flex items-end justify-between">
            <div>
              <p className="label-brand">Overhemden</p>
              <h2 className="mt-2 text-display-md">De basis van elke outfit</h2>
            </div>
            <Link href="/collections/overhemden" className="hidden font-sans text-sm text-ink underline underline-offset-4 sm:inline">
              Alle overhemden
            </Link>
          </header>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
            {overhemdHighlights.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Etiquette-blok (dresscode-expert positionering) ───────────── */}
      <section className="relative isolate overflow-hidden bg-ink text-canvas">
        <Image
          src="/brand/brand-model-tuxedo.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/30" />
        <div className="relative mx-auto max-w-page px-gutter py-16">
          <p className="label-brand !text-canvas/70">De GENTS-gids</p>
          <h2 className="mt-2 max-w-xl text-display-md !text-canvas">
            Twijfel je over de juiste dresscode?
          </h2>
          <p className="mt-4 max-w-lg font-sans text-canvas/85">
            Black tie, white tie, smart casual of jacquet — onze stylisten leggen
            elke dresscode uit, zodat je nooit hoeft te twijfelen wat je aantrekt.
          </p>
          <Link href="/pages/etiquette" className="btn-primary mt-7 !bg-canvas !text-ink hover:!bg-surface">
            Bekijk de dresscode-gids
          </Link>
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
                key={c.slug}
                href={`/categorie/${c.slug}`}
                className="flex items-center justify-between border border-line bg-canvas px-5 py-4 font-sans text-sm transition-colors hover:border-ink"
              >
                <span>{c.label}</span>
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

      <RecentStrip />
      <TrustBlock />
    </>
  );
}
