import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { BackofficeShell } from "@/components/account/report-ui";
import { DEFAULT_LOCALE, LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n";
import { getTranslationStore, toTranslationRow, hasTranslationProvider, type TranslationRow } from "@/lib/translate";
import { collectTranslationSources, TRANSLATION_NAMESPACES } from "@/lib/translation-sources";
import { TranslationsManager, type TransPayload } from "@/components/account/translations-manager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vertalingen", robots: { index: false, follow: false } };

const PAGE_SIZE = 50; // gelijk aan de API — anders klopt de paginering na de eerste fetch niet

/**
 * Site-studio → Vindbaarheid → Vertalingen. Alle Nederlandse site-teksten met
 * hun vertaling ernaast, per taal. Handmatig overschrijven zet de tekst vast:
 * de nachtelijke vertaal-cron blijft er dan af tot je 'm terugzet op automatisch.
 */
export default async function VertalingenPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");

  if (!customer.isAdmin) {
    return (
      <div className="mx-auto max-w-page px-gutter py-16">
        <h1 className="text-display-md">Geen toegang</h1>
        <p className="mt-3 font-sans text-ink-soft">Deze pagina is alleen voor beheerders.</p>
        <Link href="/account" className="mt-6 inline-block font-sans text-sm text-ink underline">← Terug naar mijn account</Link>
      </div>
    );
  }

  const targets = LOCALES.filter((l) => l !== DEFAULT_LOCALE);
  const startLocale: Locale = targets[0] || "en";
  const [sources, store] = await Promise.all([collectTranslationSources(), getTranslationStore(startLocale)]);
  const rows: TranslationRow[] = sources.map((s) => toTranslationRow(store, s.ns, s.key, s.source));

  const initial: TransPayload = {
    rows: rows.slice(0, PAGE_SIZE),
    total: rows.length,
    page: 1,
    pageSize: PAGE_SIZE,
    stats: {
      totaal: rows.length,
      vertaald: rows.filter((r) => r.value).length,
      handmatig: rows.filter((r) => r.manual).length,
      verouderd: rows.filter((r) => r.value && !r.fresh && !r.manual).length,
    },
  };

  return (
    <BackofficeShell active="/account/vertalingen" title="Vertalingen">
      <p className="font-sans text-sm text-pslate">
        De Nederlandse tekst is altijd de bron. De vertalingen worden automatisch bijgewerkt; pas je er hier één
        handmatig aan, dan blijft die staan — ook na een nieuwe vertaalronde. &quot;Verouderd&quot; betekent dat de
        Nederlandse tekst is gewijzigd nadat de vertaling gemaakt werd; tot de volgende ronde toont de site daar
        gewoon het Nederlands. Producttitels en -omschrijvingen lopen apart via de catalogus.
      </p>
      <TranslationsManager
        initial={initial}
        initialLocale={startLocale}
        locales={[...targets]}
        localeLabels={LOCALE_LABELS}
        namespaces={TRANSLATION_NAMESPACES}
        providerReady={hasTranslationProvider()}
      />
    </BackofficeShell>
  );
}
