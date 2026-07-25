import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { getAllSeoOverrides } from "@/lib/seo-overrides";
import { SeoOverridesManager, type SeoRow } from "@/components/account/seo-overrides-manager";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "SEO", robots: { index: false, follow: false } };

/**
 * Site-studio → Vindbaarheid → SEO. Per pad de meta-titel, meta-omschrijving en
 * noindex overschrijven. Zonder override bepaalt de winkel de tekst zelf; met
 * override wint deze regel, binnen 30 seconden en zonder redeploy.
 */
export default async function SeoAdminPage() {
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

  const rows: SeoRow[] = (await getAllSeoOverrides()).map((o) => ({
    path: o.path,
    title: o.title,
    description: o.description,
    noindex: o.noindex,
  }));

  return (
    <BackofficeShell active="/account/seo" title="SEO">
      <p className="max-w-3xl font-sans text-sm text-pslate">
        Bepaal zelf wat er in Google staat: de titel en de zin eronder, per pagina. Vul je niets in, dan blijft de automatische tekst staan.
        Met noindex houd je een pagina helemaal uit de zoekresultaten.
      </p>
      <SeoOverridesManager initial={rows} />
    </BackofficeShell>
  );
}
