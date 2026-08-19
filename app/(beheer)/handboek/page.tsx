import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { bouwHandboek } from "@/lib/handboek";
import { HANDBOEK_CSS } from "@/lib/handboek-stijl";
import { HandboekView } from "@/components/handboek/handboek-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Platformhandboek",
  robots: { index: false, follow: false },
};

/**
 * Het platformhandboek — de plek waar staat hoe de site, de kassa, de scanner,
 * de voorraad en de portal samenwerken.
 *
 * WAAROM HIJ HIER DRAAIT EN NIET IN DE PORTAL. Het handboek leest zijn getallen
 * live uit de instellingen en zijn lijsten uit de code van dit project. Zou hij
 * in de portal wonen, dan moest elk bedrag over een API mee en zou het handboek
 * bij elke nieuwe knop opnieuw aangepast moeten worden — precies de veroudering
 * die we willen voorkomen. De portal linkt hierheen (zelfde patroon als de
 * heatmap-viewer); daarnaast levert /api/studio/handboek dezelfde inhoud als
 * JSON, zodat de portal hem desgewenst in zijn eigen schil kan tonen.
 *
 * Eigen route-groep (beheer), dus zonder winkel-header en -footer: dit is een
 * naslagwerk en geen winkelpagina.
 *
 * Toegang volgt de heatmap-viewer: geen sessie → naar de inlog mét terugkeerpad
 * (wie in de portal werkt heeft op gents.nl zelf meestal geen sessie), wél
 * ingelogd maar geen beheerder → 404, want een klant hoeft niet te weten dat dit
 * bestaat.
 */
export default async function HandboekPagina() {
  const customer = await getSessionCustomer().catch(() => null);
  if (!customer) redirect(`/account/login?next=${encodeURIComponent("/handboek")}`);
  if (!customer.isAdmin) notFound();

  const handboek = await bouwHandboek();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: HANDBOEK_CSS }} />
      <HandboekView handboek={handboek} />
    </>
  );
}
