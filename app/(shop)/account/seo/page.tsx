import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { can } from "@/lib/permissions";
import { GeenToegang } from "@/components/account/geen-toegang";
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

  if (!can(customer, "vindbaarheid")) {
    return <GeenToegang permission="vindbaarheid" />;
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
