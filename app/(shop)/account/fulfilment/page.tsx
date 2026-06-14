import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { BackofficeShell, Section } from "@/components/account/report-ui";
import { AllocatePreview } from "@/components/account/allocate-preview";
import { SrsXmlPreview } from "@/components/account/srs-xml-preview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fulfilment", robots: { index: false, follow: false } };

export default async function FulfilmentPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");
  if (!customer.isAdmin) {
    return (
      <div className="mx-auto max-w-page px-gutter py-16">
        <h1 className="text-display-md">Geen toegang</h1>
        <Link href="/account" className="mt-6 inline-block font-sans text-sm text-ink underline">← Terug</Link>
      </div>
    );
  }

  return (
    <BackofficeShell active="/account/fulfilment" title="Fulfilment & SRS">
      <Section title="Hoe orders worden toegewezen">
        <p className="text-sm text-pslate">
          Bij een betaalde order bepaalt de allocatie-engine waar elke regel vandaan komt: <strong className="text-pnavy">magazijn-eerst</strong>, daarna winkels met voorraad, met <strong className="text-pnavy">zo min mogelijk splitsen</strong>, rekening houdend met openingstijden, cutoff-tijden en veiligheidsvoorraad. Pas daarna gaat er (als de SRS-koppeling aanstaat) per zending een weborder naar SRS. Met onderstaande test zie je het resultaat vooraf — er wordt <strong className="text-pnavy">niets verstuurd</strong>.
        </p>
      </Section>
      <AllocatePreview />

      <Section title="Echte SRS-koppeling (SOAP weborder)">
        <p className="text-sm text-pslate">
          De koppeling met SRS staat klaar (SOAP <code className="rounded bg-pnavy-50 px-1">si_weborder</code> op ws.srs.nl): na betaling wordt per zending een weborder geplaatst, ingelogd als de webshop-user (→ GENTS Webshop 90). Er gaat <strong className="text-pnavy">pas iets naar SRS als <code className="rounded bg-pnavy-50 px-1">SRS_PUSH_ENABLED=true</code></strong> staat. Valideer eerst de XML hieronder.
        </p>
      </Section>
      <SrsXmlPreview />
    </BackofficeShell>
  );
}
