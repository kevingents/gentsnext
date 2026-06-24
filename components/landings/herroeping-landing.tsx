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
        Je hebt 14 dagen bedenktijd. Wil je je aankoop herroepen? Dat kan het makkelijkst via ons{" "}
        <Link href="/pages/retourneren" className="text-ink underline">retourportaal</Link> — maar je mag ook
        onderstaand formulier gebruiken. Vul het in en stuur het naar ons.
      </p>

      <div className="mt-8 rounded-card border border-line p-6 font-sans text-sm leading-relaxed text-ink">
        <p className="text-muted">(Dit formulier alleen invullen en terugzenden als je de overeenkomst wilt herroepen.)</p>
        <dl className="mt-5 space-y-4">
          <div>
            <dt className="font-medium">{t("landing.herroeping.form.to", locale)}</dt>
            <dd className="text-ink-soft">GENTS B.V., Lemelerbergweg 15, 1101 AJ Amsterdam — <a href={`mailto:${EMAIL}`} className="underline">{EMAIL}</a></dd>
          </div>
          <div>
            <dt className="font-medium">{t("landing.herroeping.form.message", locale)}</dt>
            <dd className="text-ink-soft">Ik/Wij* deel/delen u hierbij mede dat ik/wij* onze overeenkomst betreffende de verkoop van de volgende producten herroep/herroepen*:</dd>
          </div>
          {["Bestelnummer", "Besteld op* / Ontvangen op*", "Naam consument(en)", "Adres consument(en)", "Datum"].map((label) => (
            <div key={label}>
              <dt className="font-medium">{label}</dt>
              <dd className="mt-1 h-7 border-b border-dashed border-line" />
            </div>
          ))}
          <div>
            <dt className="font-medium">{t("landing.herroeping.form.signature", locale)}</dt>
            <dd className="text-ink-soft">(alleen wanneer dit formulier op papier wordt ingediend)</dd>
            <dd className="mt-1 h-10 border-b border-dashed border-line" />
          </div>
        </dl>
        <p className="mt-5 text-xs text-muted">* Doorhalen wat niet van toepassing is.</p>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/pages/retourneren" className="btn-primary">{t("landing.herroeping.returnPortal", locale)}</Link>
        <a href={`mailto:${EMAIL}?subject=Herroeping%20bestelling`} className="btn-ghost">Mail je herroeping</a>
      </div>
    </div>
  );
}
