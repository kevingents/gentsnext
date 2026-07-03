import type { Metadata } from "next";
import Link from "next/link";
import { SizeAdvisor } from "@/components/maatadvies/size-advisor";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";

export const metadata: Metadata = {
  title: "Maatadvies — vind jouw maat",
  description:
    "Vind in een paar stappen je colbert-, lengte- en boordmaat. Het maatadvies van GENTS helpt je aan de juiste pasvorm.",
  alternates: { canonical: "/maatadvies" },
};

export default async function MaatadviesPage() {
  const locale = await getLocale();
  const t = await getT(locale);
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
        <SizeAdvisor />
      </div>
    </div>
  );
}
