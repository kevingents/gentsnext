import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { can } from "@/lib/permissions";
import { GeenToegang } from "@/components/account/geen-toegang";
import { SizeMediaForm } from "@/components/account/size-media-form";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Productmedia", robots: { index: false, follow: false } };

export default async function ProductMediaPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");
  if (!can(customer, "presentatie")) {
    return <GeenToegang permission="presentatie" />;
  }
  return (
    <BackofficeShell active="/account/productmedia" title="Modelfoto's">
      <p className="font-sans text-sm text-pslate">
        Stel per product een <strong className="text-pnavy">reguliere modelfoto</strong> in (die de galerij leidt — model eerst) en een <strong className="text-pnavy">grote-maat-foto</strong> die getoond wordt zodra de klant een grote maat kiest. AI-gegenereerd of echt — plak de afbeeldings-URL.
      </p>
      <div className="rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal">
        <SizeMediaForm />
      </div>
    </BackofficeShell>
  );
}
