import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LOOKS } from "@/lib/looks";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Shop the look",
  description: "Complete outfits voor elk moment — klik en shop de hele look.",
  alternates: { canonical: "/looks" },
};

export default function LooksPage() {
  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <p className="label-brand">Inspiratie</p>
      <h1 className="mt-2 text-display-md">Shop the look</h1>
      <p className="mt-2 max-w-xl font-sans text-ink-soft">
        Complete, door onze stylisten samengestelde outfits — per gelegenheid.
        Klik op een look en shop alle items in één keer.
      </p>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {LOOKS.map((l) => (
          <Link key={l.slug} href={`/looks/${l.slug}`} className="group">
            <div className="relative aspect-[4/5] overflow-hidden rounded-card bg-surface">
              <Image src={l.image} alt={l.title} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover transition duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/60 to-transparent" />
              <div className="absolute bottom-4 left-4">
                <p className="label-brand !text-canvas/80">{l.occasion}</p>
                <p className="mt-1 font-display text-xl font-light text-canvas">{l.title}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
