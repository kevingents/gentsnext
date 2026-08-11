import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { can } from "@/lib/permissions";
import { GeenToegang } from "@/components/account/geen-toegang";
import { getSettings } from "@/lib/settings";
import { paymentProviderStatus } from "@/lib/payments";
import { SettingsForm } from "@/components/account/settings-form";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Instellingen", robots: { index: false, follow: false } };

export default async function InstellingenPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");

  if (!can(customer, "instellingen")) {
    return <GeenToegang permission="instellingen" />;
  }

  const settings = await getSettings();
  const provider = await paymentProviderStatus();
  return (
    <BackofficeShell active="/account/instellingen" title="Instellingen">
      <p className="font-sans text-sm text-pslate">
        Verzending, levertijd en voorraad-regels. Wijzigingen werken binnen een halve minuut door in de hele winkel.
      </p>
      <div className="rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal">
        <SettingsForm initial={settings} provider={provider} />
      </div>
    </BackofficeShell>
  );
}
