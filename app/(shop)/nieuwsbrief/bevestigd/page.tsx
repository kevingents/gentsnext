import type { Metadata } from "next";
import Link from "next/link";
import { BrandedState } from "@/components/brand-state";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";

export const metadata: Metadata = { title: "Nieuwsbrief bevestigd", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ status?: string }> };

export default async function NieuwsbriefBevestigdPage({ searchParams }: Props) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { status } = await searchParams;
  const invalid = status === "ongeldig";

  if (invalid) {
    return (
      <BrandedState
        eyebrow={t("newsletter.label")}
        title={t("newsletter.invalid_title")}
        intro={t("newsletter.invalid_intro")}
      >
        <Link href="/" className="btn-primary">{t("common.back_home")}</Link>
      </BrandedState>
    );
  }

  return (
    <BrandedState
      eyebrow={t("newsletter.confirmed_eyebrow")}
      title={t("newsletter.confirmed_title")}
      intro={t("newsletter.confirmed_intro")}
    >
      <Link href="/" className="btn-primary">{t("common.browse_now")}</Link>
    </BrandedState>
  );
}
