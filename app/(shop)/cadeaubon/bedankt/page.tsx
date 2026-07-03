import type { Metadata } from "next";
import Link from "next/link";
import { BrandedState } from "@/components/brand-state";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bedankt voor je cadeaubon", robots: { index: false } };

export default async function GiftcardThanksPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  return (
    <BrandedState
      eyebrow={t("giftcard.label")}
      title={t("giftcard.thanks_title")}
      intro={t("giftcard.thanks_intro")}
    >
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-primary">{t("welcome.continue")}</Link>
        <Link href="/pages/klantenservice" className="btn-ghost">{t("giftcard.customer_service")}</Link>
      </div>
    </BrandedState>
  );
}
