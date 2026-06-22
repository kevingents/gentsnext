import type { Metadata } from "next";
import { getAllLooks, getLooksHeroes } from "@/lib/looks";
import { localeAlternates } from "@/lib/seo";
import { LooksGrid } from "@/components/looks/looks-grid";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Shop the look",
    description: "Complete outfits voor elk moment — klik en shop de hele look.",
    alternates: await localeAlternates("/looks"),
  };
}

export default async function LooksPage() {
  const looks = await getAllLooks();
  const heroes = await getLooksHeroes(looks);
  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <p className="label-brand">Inspiratie</p>
      <h1 className="mt-2 text-display-md">Shop the look</h1>
      <p className="mt-2 max-w-xl font-sans text-ink-soft">
        Complete, door onze stylisten samengestelde outfits — per gelegenheid.
        Klik op een look en shop alle items in één keer.
      </p>
      <LooksGrid looks={looks.map((l) => ({ slug: l.slug, title: l.title, occasion: l.occasion, theme: l.theme, image: heroes[l.slug] ?? l.image }))} />
    </div>
  );
}
