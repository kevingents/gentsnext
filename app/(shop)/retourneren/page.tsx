import type { Metadata } from "next";
import { RetourFlow } from "@/components/returns/retour-flow";
import { localeAlternates } from "@/lib/seo";
import { getSessionCustomer } from "@/lib/account";
import { getReturnableOrder } from "@/lib/returns";
import { getSettings } from "@/lib/settings";
import { getStores } from "@/lib/stores";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Retourneren — GENTS",
    description: "Iets retourneren? Start hier of vanuit je bestelling. Kies een DHL-retourlabel of inleveren in de winkel, en geld terug of GENTS-tegoed (gratis retour).",
    alternates: await localeAlternates("/retourneren"),
    robots: { index: true, follow: true },
  };
}

export default async function RetournerenPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = await searchParams;
  const orderNr = String(order || "").trim();

  // Ingelogd + bestelnummer → direct de retourbare regels (sessie = bewijs, geen e-mail nodig).
  let prefill: React.ComponentProps<typeof RetourFlow>["prefill"] = null;
  if (orderNr) {
    const customer = await getSessionCustomer();
    if (customer?.email) {
      const base = await getReturnableOrder(orderNr, customer.email);
      if (base.ok) {
        const { returnConfig } = await getSettings();
        prefill = {
          orderNumber: base.orderNumber,
          email: customer.email,
          lines: base.lines.filter((l) => l.returnableQty > 0),
          policy: returnConfig,
          withinWindow: base.withinWindow,
        };
      }
    }
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <div className="mx-auto max-w-2xl">
        <p className="label-brand">Service</p>
        <h1 className="mt-2 text-display-md">Retourneren</h1>
        <p className="mt-3 font-sans text-ink-soft">
          Niet helemaal goed? Je hebt 14 dagen bedenktijd. Kies <strong>tegoed/omruilen</strong> en je retour is
          <strong> gratis</strong>. Bij geld terug rekenen we de retourkosten (gelijk aan de heenzending, € 4,99).
          Inleveren kan met een DHL-retourlabel of in een GENTS-winkel.
        </p>
        <div className="mt-8">
          <RetourFlow initialOrder={orderNr} prefill={prefill} stores={getStores().map((s) => s.title)} />
        </div>
      </div>
    </div>
  );
}
