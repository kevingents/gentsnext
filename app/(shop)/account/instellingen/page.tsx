import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { getSettings } from "@/lib/settings";
import { SettingsForm } from "@/components/account/settings-form";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Instellingen", robots: { index: false, follow: false } };

export default async function InstellingenPage() {
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

  const settings = await getSettings();
  return (
    <BackofficeShell active="/account/instellingen" title="Instellingen">
      <p className="font-sans text-sm text-pslate">
        Verzending, levertijd en voorraad-regels. Wijzigingen werken binnen een halve minuut door in de hele winkel.
      </p>
      <div className="rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal">
        <SettingsForm initial={settings} />
      </div>
    </BackofficeShell>
  );
}
