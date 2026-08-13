import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CLUB_LOGO_DARK, CLUB_LOGO_SIZE, CLUB_NAME, CLUB_PATH } from "@/lib/club";
import { formatEuro } from "@/lib/format";
import { getLocale } from "@/lib/locale-server";
import { getSessionCustomer } from "@/lib/account";
import { getSettings } from "@/lib/settings";
import { getT } from "@/lib/t-server";
import { localeAlternates } from "@/lib/seo";
import { walletConfigured } from "@/lib/apple-wallet-config";
import { googleWalletConfigured } from "@/lib/google-wallet-config";

/**
 * /club — de publieke uitlegpagina van The Club of GENTS.
 *
 * Eén regel voor deze pagina: er staat GEEN getal in de teksten. Koers, drempel,
 * vestingtermijn en bonusbedragen komen uit `loyaltyConfig` (Instellingen in de
 * portal) en gaan als {placeholder} de vertaalsleutel in. Draait Kevin aan een
 * knop, dan verandert de belofte op deze pagina mee — dezelfde afspraak als op
 * /retourneren met returnConfig.
 *
 * Bewust NIET op deze pagina: "nog X euro besteden tot je volgende beloning".
 * De punten-per-euro van de webshop en die van de kassa zijn twee aparte knoppen
 * (storegents rekent met een eigen regel), dus zo'n omrekening zou een belofte
 * doen die we niet in één plek vastleggen.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(await getLocale());
  return {
    title: t("club.meta.title"),
    description: t("club.meta.description"),
    alternates: await localeAlternates(CLUB_PATH),
  };
}

export default async function ClubPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { loyaltyConfig } = await getSettings();
  const customer = await getSessionCustomer();

  const perEuro = Number(loyaltyConfig?.pointsPerEuro) > 0 ? Number(loyaltyConfig.pointsPerEuro) : 1;
  const minPoints = Math.max(1, Number(loyaltyConfig?.redeemMinPoints) || 500);
  const stepPoints = Math.max(0, Number(loyaltyConfig?.redeemStepPoints) || 0);
  const centsPerPoint = Number(loyaltyConfig?.redeemCentsPerPoint) > 0 ? Number(loyaltyConfig.redeemCentsPerPoint) : 5;
  const vestingDays = Math.max(0, Number(loyaltyConfig?.vestingDays) || 0);
  const voucherDays = Math.max(0, Number(loyaltyConfig?.redeemVoucherDays) || 0);
  const drempelBedrag = formatEuro(minPoints * centsPerPoint);

  /* De bonussen komen één op één uit dezelfde instelling als het takenlijstje in
     het account (lib/loyalty-bonus). Een bonus op 0 staat uit → hier ook niet
     tonen, anders belooft de publieke pagina punten die niemand krijgt. */
  const bp = loyaltyConfig?.bonusPoints;
  const bonussen = [
    { key: "account", punten: Number(bp?.accountCreated) || 0, titel: t("club.bonus.account.title"), body: t("club.bonus.account.body") },
    { key: "maatadvies", punten: Number(bp?.sizeAdvice) || 0, titel: t("account.bonus.size.title"), body: t("account.bonus.size.body") },
    { key: "wallet", punten: Number(bp?.walletPass) || 0, titel: t("account.bonus.wallet.title"), body: t("account.bonus.wallet.body") },
    { key: "winkel", punten: Number(bp?.favoriteStore) || 0, titel: t("account.bonus.store.title"), body: t("account.bonus.store.body") },
    { key: "profiel", punten: Number(bp?.profileComplete) || 0, titel: t("account.bonus.profile.title"), body: t("account.bonus.profile.body") },
  ].filter((b) => b.punten > 0);

  const passEnabled = walletConfigured() || googleWalletConfigured();

  const stappen = [
    { titel: t("club.how.step1.title"), body: t("club.how.step1.body") },
    { titel: t("club.how.step2.title"), body: t("club.how.step2.body") },
    { titel: t("club.how.step3.title"), body: t("club.how.step3.body", { min: minPoints, amount: drempelBedrag }) },
  ];

  const voorwaarden = [
    vestingDays > 0 ? t("club.terms.vesting", { days: vestingDays }) : "",
    t("club.terms.returns"),
    voucherDays > 0 ? t("club.terms.voucher", { days: voucherDays }) : "",
    t("club.terms.rounding"),
    t("club.terms.free"),
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-page px-gutter py-14">
      <header className="max-w-2xl">
        <p className="label-brand">{t("club.eyebrow")}</p>
        {/* Het merkteken ÍS de kop. In een h1 met alt-tekst, zodat de pagina voor
            Google en een schermlezer nog steeds "The Club of GENTS" heet. */}
        <h1 className="mt-4">
          <Image
            src={CLUB_LOGO_DARK}
            alt={CLUB_NAME}
            width={CLUB_LOGO_SIZE.width}
            height={CLUB_LOGO_SIZE.height}
            priority
            sizes="(max-width: 640px) 80vw, 384px"
            className="h-auto w-full max-w-[24rem]"
          />
        </h1>
        <p className="mt-4 font-sans text-ink-soft">{t("club.intro")}</p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link
            href={customer ? "/account" : "/account/login"}
            className="inline-flex items-center justify-center bg-ink px-6 py-3 font-sans text-sm text-canvas transition-opacity hover:opacity-90"
          >
            {customer ? t("club.cta.account") : t("club.cta.join")}
          </Link>
          {!customer && <p className="font-sans text-sm text-muted">{t("club.cta.note")}</p>}
        </div>
      </header>

      {/* De koers — het enige harde getal op de pagina, en dus uit de instellingen. */}
      <section className="mt-12 grid gap-px border border-line bg-line sm:grid-cols-2">
        <div className="bg-canvas p-6">
          <p className="label-brand">{t("club.rate.earn.label")}</p>
          <p className="mt-2 font-display text-2xl font-light">
            {perEuro === 1
              ? t("club.rate.earn.one", { points: perEuro })
              : t("club.rate.earn.other", { points: perEuro })}
          </p>
        </div>
        <div className="bg-canvas p-6">
          <p className="label-brand">{t("club.rate.redeem.label")}</p>
          <p className="mt-2 font-display text-2xl font-light">
            {t("club.rate.redeem.value", { min: minPoints, amount: drempelBedrag })}
          </p>
          <p className="mt-1 font-sans text-sm text-muted">
            {stepPoints > 0 ? t("club.rate.step", { step: stepPoints }) : t("club.rate.free")}
          </p>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="font-display text-2xl font-light">{t("club.how.title")}</h2>
        <ol className="mt-6 grid gap-8 md:grid-cols-3">
          {stappen.map((s, i) => (
            <li key={s.titel}>
              <p className="font-display text-3xl font-light text-muted">{i + 1}</p>
              <h3 className="mt-2 font-sans text-base text-ink">{s.titel}</h3>
              <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {bonussen.length > 0 && (
        <section className="mt-16">
          <h2 className="font-display text-2xl font-light">{t("club.bonus.title")}</h2>
          <p className="mt-2 max-w-2xl font-sans text-sm text-ink-soft">{t("club.bonus.intro")}</p>
          <ul className="mt-6 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {bonussen.map((b) => (
              <li key={b.key} className="bg-canvas p-6">
                <p className="label-brand">{t("club.bonus.points", { n: b.punten })}</p>
                <h3 className="mt-2 font-sans text-base text-ink">{b.titel}</h3>
                <p className="mt-1.5 font-sans text-sm leading-relaxed text-ink-soft">{b.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-16 grid gap-10 md:grid-cols-2">
        {passEnabled && (
          <div>
            <h2 className="font-display text-2xl font-light">{t("club.pass.title")}</h2>
            <p className="mt-3 font-sans text-sm leading-relaxed text-ink-soft">{t("club.pass.body")}</p>
            <Link
              href={customer ? "/account" : "/account/login"}
              className="mt-4 inline-block font-sans text-sm text-ink underline underline-offset-4"
            >
              {t("club.pass.cta")}
            </Link>
          </div>
        )}
        <div>
          <h2 className="font-display text-2xl font-light">{t("club.store.title")}</h2>
          <p className="mt-3 font-sans text-sm leading-relaxed text-ink-soft">{t("club.store.body")}</p>
        </div>
      </section>

      <section className="mt-16 border-t border-line pt-8">
        <h2 className="font-sans text-base text-ink">{t("club.terms.title")}</h2>
        <ul className="mt-4 max-w-3xl space-y-2">
          {voorwaarden.map((v) => (
            <li key={v} className="font-sans text-sm leading-relaxed text-muted">
              {v}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
