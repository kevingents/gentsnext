import type { Metadata } from "next";
import { Link } from "@/components/i18n/link";
import { SizeAdvisor } from "@/components/maatadvies/size-advisor";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";
import { bonusPointsFor } from "@/lib/loyalty-bonus";
import { pageMetadata } from "@/lib/page-meta-i18n";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata("/maatadvies");
}

export default async function MaatadviesPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const bonusPoints = await bonusPointsFor("maatadvies");
  return (
    <div className="mx-auto max-w-page px-gutter py-14">
      <div className="max-w-2xl">
        <p className="label-brand">{t("sizing.label")}</p>
        <h1 className="mt-2 text-display-lg">{t("sizing.title")}</h1>
        <p className="mt-4 font-sans text-ink-soft">
          {t("sizing.intro")}
        </p>
        <p className="mt-3 font-sans text-sm text-ink-soft">
          {t("maatadvies.tables.question")}{" "}
          <Link href="/maattabellen" className="text-ink underline underline-offset-4">
            {t("maatadvies.tables.link")}
          </Link>
          .
        </p>
      </div>
      <div className="mt-12">
        <SizeAdvisor bonusPoints={bonusPoints} />
      </div>
    </div>
  );
}
