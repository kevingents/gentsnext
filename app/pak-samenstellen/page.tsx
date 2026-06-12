import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { listSuits } from "@/lib/suit-pairing";
import { formatEuro } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pak samenstellen",
  description:
    "Stel je eigen pak samen: kies colbert en pantalon in de maat die jou past, met of zonder gilet. Prijs is de som van de onderdelen.",
  alternates: { canonical: "/pak-samenstellen" },
};

export default async function PakSamenstellenPage() {
  let suits: Awaited<ReturnType<typeof listSuits>> = [];
  try {
    suits = await listSuits();
  } catch {
    // DB niet bereikbaar — toon alleen de intro.
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <div className="max-w-2xl">
        <p className="label-brand">Op jouw maat</p>
        <h1 className="mt-2 text-display-lg">Stel je pak samen</h1>
        <p className="mt-4 font-sans text-ink-soft">
          Kies een pak en bepaal zelf de uitvoering: 2-delig met colbert en
          pantalon, of 3-delig met gilet. Je kiest één maat — wij voegen de
          bijpassende onderdelen toe. De prijs is de som van de onderdelen.
        </p>
      </div>

      {suits.length === 0 ? (
        <p className="mt-12 font-sans text-ink-soft">
          Er zijn op dit moment geen samenstelbare pakken beschikbaar.
        </p>
      ) : (
        <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {suits.map((s) => (
            <Link key={s.code} href={`/pak-samenstellen/${s.colbertHandle}`} className="group flex flex-col gap-3">
              <div className="relative aspect-[3/4] overflow-hidden rounded-card bg-surface">
                {s.image ? (
                  <Image
                    src={s.image}
                    alt={s.title}
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    className="object-cover transition duration-500 ease-brand group-hover:scale-[1.04]"
                  />
                ) : null}
                <span className="absolute left-2 top-2 bg-canvas/90 px-2 py-0.5 font-sans text-[0.65rem] uppercase tracking-wide">
                  {s.threePiece ? "2- of 3-delig" : "2-delig"}
                </span>
              </div>
              <div>
                <h2 className="font-sans text-sm text-ink">{s.title}</h2>
                <p className="font-sans text-sm text-ink-soft">vanaf {formatEuro(s.fromCents)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
