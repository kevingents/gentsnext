import type { Metadata } from "next";
import { RetourFlow } from "@/components/returns/retour-flow";
import { localeAlternates } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Retourneren — GENTS",
    description: "Iets retourneren? Start hier met je bestelnummer. Kies een DHL-retourlabel of inleveren in de winkel, en geld terug of GENTS-tegoed (gratis retour).",
    alternates: await localeAlternates("/retourneren"),
  };
}

export default async function RetournerenPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = await searchParams;
  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <div className="mx-auto max-w-2xl">
        <p className="label-brand">Service</p>
        <h1 className="mt-2 text-display-md">Retourneren</h1>
        <p className="mt-3 font-sans text-ink-soft">
          Niet helemaal goed? Je hebt 14 dagen bedenktijd. Kies <strong>tegoed/omruilen</strong> en je retour is
          <strong> gratis</strong> — of kies geld terug. Inleveren kan met een DHL-retourlabel of in een GENTS-winkel.
        </p>
        <div className="mt-8">
          <RetourFlow initialOrder={String(order || "")} />
        </div>
      </div>
    </div>
  );
}
