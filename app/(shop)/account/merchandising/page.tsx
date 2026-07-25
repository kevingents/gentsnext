import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { can } from "@/lib/permissions";
import { GeenToegang } from "@/components/account/geen-toegang";
import { getAllMerchandisingPins } from "@/lib/merchandising";
import { getPinSinceMap, listPinContexts, resolvePinItems, type PinItem } from "@/lib/merchandising-admin";
import { MerchandisingEditor } from "@/components/account/merchandising-editor";
import { BackofficeShell } from "@/components/account/report-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Uitgelicht", robots: { index: false, follow: false } };

/**
 * Site-studio → Uitgelicht: producten bovenaan een categorie- of collectiepagina
 * vastzetten (merchandising-pins). Beheer hoort in de webshop zelf, niet meer in
 * de portal — de portal-route blijft bestaan, maar deelt dezelfde settings-store.
 */
export default async function MerchandisingPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");

  if (!can(customer, "presentatie")) {
    return <GeenToegang permission="presentatie" />;
  }

  const [allPins, since] = await Promise.all([getAllMerchandisingPins(), getPinSinceMap()]);
  // De store is vrij vormgegeven JSON: alleen echte handle-lijsten gebruiken.
  const handlesByKey = new Map<string, string[]>();
  for (const [key, value] of Object.entries(allPins)) {
    if (Array.isArray(value)) {
      handlesByKey.set(key, value.filter((h): h is string => typeof h === "string" && h.trim().length > 0));
    }
  }
  const keys = [...handlesByKey.keys()];
  const [contexts, resolved] = await Promise.all([
    listPinContexts(keys),
    resolvePinItems([...handlesByKey.values()].flat()),
  ]);

  // Eén keer resolven, daarna per context in de gepinde volgorde terugleggen.
  const byHandle = new Map(resolved.map((i) => [i.handle, i]));
  const pins: Record<string, PinItem[]> = {};
  for (const key of keys) {
    pins[key] = (handlesByKey.get(key) || []).map(
      (h) => byHandle.get(h) || { handle: h, title: h, imageUrl: "", priceCents: null, known: false }
    );
  }

  return (
    <BackofficeShell active="/account/merchandising" title="Uitgelicht">
      <p className="font-sans text-sm text-pslate">
        Zet per categorie of collectie producten bovenaan de lijst. Een wijziging staat binnen een halve minuut live op
        de winkelpagina.
      </p>
      <MerchandisingEditor contexts={contexts} pins={pins} since={since} />
    </BackofficeShell>
  );
}
