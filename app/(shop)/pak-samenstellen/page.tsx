import type { Metadata } from "next";
import { listSuits } from "@/lib/suit-pairing";
import { SuitFilters } from "@/components/pak/suit-filters";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";
import { pageMetadata } from "@/lib/page-meta-i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata("/pak-samenstellen");
}

export default async function PakSamenstellenPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  let suits: Awaited<ReturnType<typeof listSuits>> = [];
  try {
    suits = await listSuits();
  } catch {
    // DB niet bereikbaar — toon alleen de intro.
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <div className="max-w-2xl">
        <p className="label-brand">{t("suit_builder.label")}</p>
        <h1 className="mt-2 text-display-lg">{t("suit_builder.title")}</h1>
        <p className="mt-4 font-sans text-ink-soft">
          {t("suit_builder.intro")}
        </p>
      </div>

      {suits.length === 0 ? (
        <p className="mt-12 font-sans text-ink-soft">
          {t("suit_builder.no_suits")}
        </p>
      ) : (
        <SuitFilters
          suits={suits}
          labels={{
            twoPiece: t("suit_builder.two_piece"),
            twoOrThreePiece: t("suit_builder.two_or_three_piece"),
            from: t("suit_builder.from"),
            allFits: t("suit_builder.all_fits"),
            allColors: t("suit_builder.all_colors"),
            threePieceOnly: t("suit_builder.three_piece_only"),
            results: t("suit_builder.results"),
            reset: t("suit_builder.reset"),
            noMatch: t("suit_builder.no_match"),
          }}
        />
      )}
    </div>
  );
}
