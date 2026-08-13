import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { GEMETEN_PAGINAS } from "@/lib/heatmap-paginas";
import { HeatmapViewer } from "@/components/heatmap/heatmap-viewer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Heatmap",
  robots: { index: false, follow: false },
};

/**
 * De heatmap-viewer draait hier, in gentsnext zelf, en niet in de portal. Dat
 * is geen inconsistentie met "beheer hoort in de portal": de kleurlaag moet
 * over de échte pagina liggen, en dat kan alleen als het frame same-origin is
 * (X-Frame-Options staat op SAMEORIGIN). Vanuit de portal — ander domein — is
 * het document in het frame onleesbaar en weet je dus niet hoe hoog de pagina
 * is of waar de elementen staan.
 *
 * De cijfers erachter zitten wél gewoon op /api/studio/site/heatmap, zodat de
 * portal ze kan tonen zonder de viewer over te nemen.
 *
 * Eigen route-groep (beheer) zodat de storefront-header en -footer er niet
 * omheen komen: die zouden in de viewer twee keer in beeld staan.
 */
export default async function HeatmapPagina() {
  const customer = await getSessionCustomer().catch(() => null);
  // notFound i.p.v. een foutmelding: wie geen beheerder is hoeft niet te weten
  // dat deze pagina bestaat.
  if (!customer?.isAdmin) notFound();

  return <HeatmapViewer paginas={GEMETEN_PAGINAS} />;
}
