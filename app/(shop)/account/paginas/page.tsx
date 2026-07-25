import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { getStorePages } from "@/lib/content-pages";
import { reservedPageSlugs } from "@/lib/reserved-page-slugs";
import { PagesEditor } from "@/components/account/pages-editor";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pagina's", robots: { index: false, follow: false } };

export default async function PaginasAdminPage() {
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

  const pages = await getStorePages();
  const reserved = reservedPageSlugs();

  return (
    <BackofficeShell active="/account/paginas" title="Pagina's">
      <p className="font-sans text-sm text-pslate">
        Je eigen tekstpagina&apos;s op de site, bereikbaar via /pages/webadres. Wijzigingen zijn binnen een halve
        minuut live. Verwijderen doe je door de pagina weg te halen en daarna op te slaan — de oude URL geeft dan
        een 404, dus zet er zo nodig een redirect voor klaar.
      </p>
      <div className="rounded-xl border border-pnavy-100 bg-white p-4 text-sm text-pslate shadow-portal">
        <p className="font-medium text-pnavy">Al bezette webadressen</p>
        <p className="mt-1">
          Deze webadressen horen bij vaste pagina&apos;s (winkels, klantenservice, etiquette…). Een eigen pagina
          hierop zou nooit getoond worden, dus die worden geweigerd.
        </p>
        <p className="mt-2 break-words font-mono text-xs text-pnavy">{reserved.join(" · ")}</p>
      </div>
      <PagesEditor initial={pages} reserved={reserved} />
    </BackofficeShell>
  );
}
