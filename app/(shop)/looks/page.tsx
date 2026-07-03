import type { Metadata } from "next";
import { getAllLooks, getLooksHeroes } from "@/lib/looks";
import { localeAlternates } from "@/lib/seo";
import { LooksGrid } from "@/components/looks/looks-grid";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Shop the look",
    description: "Complete outfits voor elk moment — klik en shop de hele look.",
    alternates: await localeAlternates("/looks"),
  };
}

export default async function LooksPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const looks = await getAllLooks();
  const heroes = await getLooksHeroes(looks);
  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <p className="label-brand">{t("looks.inspiration_label")}</p>
      <h1 className="mt-2 text-display-md">{t("looks.title")}</h1>
      <p className="mt-2 max-w-xl font-sans text-ink-soft">
        {t("looks.intro")}
      </p>
      <LooksGrid looks={looks.map((l) => ({ slug: l.slug, title: l.title, occasion: l.occasion, theme: l.theme, image: heroes[l.slug] ?? l.image }))} />
    </div>
  );
}
