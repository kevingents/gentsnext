import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { can } from "@/lib/permissions";
import { GeenToegang } from "@/components/account/geen-toegang";
import { BackofficeShell, Section } from "@/components/account/report-ui";
import { AllocatePreview } from "@/components/account/allocate-preview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fulfilment", robots: { index: false, follow: false } };

export default async function FulfilmentPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");
  if (!can(customer, "operatie")) {
    return <GeenToegang permission="operatie" />;
  }

  return (
    <BackofficeShell active="/account/fulfilment" title="Fulfilment & SRS">
      <Section title="Hoe orders worden toegewezen">
        <p className="text-sm text-pslate">
          Bij een betaalde order bepaalt de allocatie-engine waar elke regel vandaan komt: <strong className="text-pnavy">magazijn-eerst</strong>, daarna winkels met voorraad, met <strong className="text-pnavy">zo min mogelijk splitsen</strong>, rekening houdend met openingstijden, cutoff-tijden en veiligheidsvoorraad. Met onderstaande test zie je het resultaat vooraf — er wordt <strong className="text-pnavy">niets verstuurd</strong>.
        </p>
      </Section>
      <AllocatePreview />

      <Section title="Waar komt de voorraad vandaan">
        <p className="text-sm text-pslate">
          SRS is voor de webshop <strong className="text-pnavy">alleen nog voorraadbron</strong>: de standen komen periodiek binnen en staan in onze eigen database. Er gaat <strong className="text-pnavy">geen weborder meer naar SRS</strong> — het pakken en verzenden loopt via de portal en de winkels.
        </p>
      </Section>
    </BackofficeShell>
  );
}
