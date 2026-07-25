import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { getMenu } from "@/lib/menu-server";
import { MenuEditor } from "@/components/account/menu-editor";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Menu", robots: { index: false, follow: false } };

export default async function MenuAdminPage() {
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

  const items = await getMenu();

  return (
    <BackofficeShell active="/account/menu" title="Menu">
      <p className="font-sans text-sm text-pslate">
        Het hoofdmenu bovenaan de site: de items in de balk, de kolommen in het uitklapmenu en de volgorde.
        Wijzigingen zijn binnen een halve minuut live.
      </p>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">Let op bij andere talen</p>
        <p className="mt-1">
          Menu-namen lopen via de vertaalrail. Een nieuwe of gewijzigde naam staat meteen goed in het Nederlands,
          maar verschijnt in het Engels, Duits, Frans en Spaans pas ná de nachtelijke vertaalronde. Tot die tijd
          tonen die talen de Nederlandse tekst.
        </p>
      </div>
      <MenuEditor initial={items} />
    </BackofficeShell>
  );
}
