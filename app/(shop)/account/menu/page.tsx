import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { can } from "@/lib/permissions";
import { GeenToegang } from "@/components/account/geen-toegang";
import { getMenu } from "@/lib/menu-server";
import { MenuEditor } from "@/components/account/menu-editor";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Menu", robots: { index: false, follow: false } };

export default async function MenuAdminPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");

  if (!can(customer, "content")) {
    return <GeenToegang permission="content" />;
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
