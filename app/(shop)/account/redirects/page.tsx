import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { listRedirects } from "@/lib/redirects-admin";
import { RedirectsManager, type RedirectRow } from "@/components/account/redirects-manager";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Redirects", robots: { index: false, follow: false } };

/**
 * Site-studio → Vindbaarheid → Redirects. Oude URL's (Shopify-erfenis, hernoemde
 * pagina's) naar het juiste nieuwe adres sturen, zonder redeploy: de middleware
 * leest dezelfde bron en ververst binnen 30 seconden.
 */
export default async function RedirectsAdminPage() {
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

  const list = await listRedirects();
  const rows: RedirectRow[] = list.map((r) => ({
    source: String(r.source || ""),
    target: String(r.target || ""),
    status: Number(r.status) === 302 ? 302 : 301,
    active: r.active !== false,
  }));

  return (
    <BackofficeShell active="/account/redirects" title="Redirects">
      <p className="max-w-3xl font-sans text-sm text-pslate">
        Stuur een oud webadres door naar het juiste nieuwe adres. Handig na het hernoemen van een pagina of voor links uit de oude webshop:
        bezoekers en Google komen zo alsnog goed uit. Wijzigingen werken binnen een halve minuut door — een redeploy is niet nodig.
      </p>
      <RedirectsManager initial={rows} />
    </BackofficeShell>
  );
}
