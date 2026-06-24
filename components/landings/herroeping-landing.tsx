import Link from "next/link";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/messages";

const EMAIL = process.env.CONTACT_EMAIL || "klantenservice@gents.nl";

/**
 * Wettelijk modelformulier voor herroeping (bijlage I EU-Consumentenrechten-
 * richtlijn / art. 6:230o BW). De klant hóeft het niet te gebruiken, maar we
 * moeten het wel aanbieden. Daarnaast wijzen we op de makkelijkere retourroute.
 */
export async function HerroepingLanding() {
  const locale = await getLocale();
  return (
    <div className="mx-auto max-w-2xl px-gutter py-12">
      <p className="label-brand">{t("landing.herroeping.label", locale)}</p>
      <h1 className="mt-2 text-display-md">{t("landing.herroeping.title", locale)}</h1>
      <p className="mt-3 font-sans text-ink-soft">
        {t("landing.herroeping.intro1", locale)}{" "}
        <Link href="/pages/retourneren" className="text-ink underline">{t("landing.herroeping.returnPortalWord", locale)}</Link>
        {" "}{t("landing.herroeping.intro2", locale)}
      </p>

      <div className="mt-8 rounded-card border border-line p-6 font-sans text-sm leading-relaxed text-ink">
        <p className="text-muted">{t("landing.herroeping.formNote", locale)}</p>
        <dl className="mt-5 space-y-4">
          <div>
            <dt className="font-medium">{t("landing.herroeping.form.to", locale)}</dt>
            <dd className="text-ink-soft">GENTS B.V., Lemelerbergweg 15, 1101 AJ Amsterdam — <a href={`mailto:${EMAIL}`} className="underline">{EMAIL}</a></dd>
          </div>
          <div>
            <dt className="font-medium">{t("landing.herroeping.form.message", locale)}</dt>
            <dd className="text-ink-soft">{t("landing.herroeping.messageBody", locale)}</dd>
          </div>
          {[
            t("landing.herroeping.form.orderNumber", locale),
            t("landing.herroeping.form.orderedReceived", locale),
            t("landing.herroeping.form.consumerName", locale),
            t("landing.herroeping.form.consumerAddress", locale),
            t("landing.herroeping.form.date", locale),
          ].map((label) => (
            <div key={label}>
              <dt className="font-medium">{label}</dt>
              <dd className="mt-1 h-7 border-b border-dashed border-line" />
            </div>
          ))}
          <div>
            <dt className="font-medium">{t("landing.herroeping.form.signature", locale)}</dt>
            <dd className="text-ink-soft">{t("landing.herroeping.signatureNote", locale)}</dd>
            <dd className="mt-1 h-10 border-b border-dashed border-line" />
          </div>
        </dl>
        <p className="mt-5 text-xs text-muted">{t("landing.herroeping.strikeNote", locale)}</p>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/pages/retourneren" className="btn-primary">{t("landing.herroeping.returnPortal", locale)}</Link>
        <a href={`mailto:${EMAIL}?subject=Herroeping%20bestelling`} className="btn-ghost">{t("landing.herroeping.mailButton", locale)}</a>
      </div>
    </div>
  );
}
