import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { getSessionCustomer } from "@/lib/account";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";
import { GiftcardBuyForm } from "@/components/giftcard/giftcard-buy-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cadeaubon",
  description: "Geef GENTS cadeau. Een digitale cadeaubon, direct per e-mail bij de ontvanger — te besteden op alles in de collectie.",
};

const USP_KEYS = [
  "giftcard.usp_email",
  "giftcard.usp_full_collection",
  "giftcard.usp_multiple_uses",
  "giftcard.usp_free_shipping",
];

export default async function CadeaubonPage({ searchParams }: { searchParams: Promise<{ geannuleerd?: string }> }) {
  const { geannuleerd } = await searchParams;
  const locale = await getLocale();
  const t = await getT(locale);
  const [{ giftcardConfig: cfg }, customer] = await Promise.all([getSettings(), getSessionCustomer()]);

  if (!cfg.enabled) {
    return (
      <div className="mx-auto max-w-page px-gutter py-20 text-center">
        <h1 className="text-display-md">{t("giftcard.unavailable_title")}</h1>
        <p className="mt-3 font-sans text-ink-soft">{t("giftcard.unavailable")}</p>
        <Link href="/" className="btn-ghost mt-8 inline-flex">{t("common.back_home")}</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <p className="label-brand">{t("giftcard.label")}</p>
      <h1 className="mt-2 text-display-md">{t("giftcard.title")}</h1>

      {geannuleerd ? (
        <div className="mt-6 rounded-card border border-line bg-surface px-4 py-3 font-sans text-sm text-ink-soft">
          <span className="font-medium text-ink">{t("giftcard.payment_canceled")}</span> {t("giftcard.try_again")}
        </div>
      ) : null}

      <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="max-w-prose font-sans text-ink-soft">
            {t("giftcard.intro")}
          </p>
          <ul className="mt-6 space-y-2.5">
            {USP_KEYS.map((u) => (
              <li key={u} className="flex items-start gap-2.5 font-sans text-sm text-ink-soft">
                <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t(u)}
              </li>
            ))}
          </ul>
          <p className="mt-8 font-sans text-xs text-muted">
            {t("giftcard.redeem_note")}
          </p>
        </div>

        <GiftcardBuyForm
          presetCents={cfg.presetAmountsCents}
          minCents={cfg.minCents}
          maxCents={cfg.maxCents}
          validityMonths={cfg.validityMonths}
          defaultBuyerEmail={customer?.email ?? ""}
        />
      </div>
    </div>
  );
}
