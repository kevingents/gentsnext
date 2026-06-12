import type { Metadata } from "next";
import Link from "next/link";

/**
 * Generieke /pages/<handle>-route — houdt de Shopify-menustructuur heel
 * (winkels, trouw-afspraak, students, …) tijdens de bouw. De echte
 * content-/CMS-pagina's volgen in de content-fase; tot dan een nette
 * "binnenkort"-weergave i.p.v. een 404.
 */
const KNOWN_TITLES: Record<string, string> = {
  winkels: "Onze winkels",
  "trouw-afspraak": "Trouwafspraak maken",
  students: "Voor studenten & verenigingen",
  zakelijk: "Zakelijk",
  service: "Service",
  etiquette: "Etiquette & dresscodes",
};

function titleFor(handle: string): string {
  if (KNOWN_TITLES[handle]) return KNOWN_TITLES[handle];
  return handle
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  return { title: titleFor(handle), robots: { index: false } };
}

export default async function GenericPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return (
    <div className="mx-auto max-w-page px-gutter py-20">
      <div className="max-w-xl">
        <p className="label-brand">Binnenkort</p>
        <h1 className="mt-2 text-display-md">{titleFor(handle)}</h1>
        <p className="mt-4 font-sans text-ink-soft">
          Deze pagina wordt binnenkort toegevoegd. Bekijk ondertussen ons
          assortiment of vraag onze stylisten om advies.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/collections/pakken" className="btn-primary">
            Shop pakken
          </Link>
          <Link href="/" className="btn-ghost">
            Naar home
          </Link>
        </div>
      </div>
    </div>
  );
}
