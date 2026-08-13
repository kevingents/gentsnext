import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { GEMETEN_PAGINAS, isApparaat, type Apparaat } from "@/lib/heatmap-paginas";
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
 *
 * `?pagina=&apparaat=&dagen=` zet de viewer meteen op de goede combinatie. Dat
 * is er voor de portal: die toont de cijfers per pagina in de lijst, en per rij
 * hoort één klik je op de bijbehorende kleurlaag te zetten. Zonder deze
 * parameters kwam je altijd op de homepage-mobiel uit en moest je de pagina die
 * je net aanklikte zelf opnieuw opzoeken.
 */
export default async function HeatmapPagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const customer = await getSessionCustomer().catch(() => null);
  // notFound i.p.v. een foutmelding: wie geen beheerder is hoeft niet te weten
  // dat deze pagina bestaat.
  if (!customer?.isAdmin) notFound();

  const params = await searchParams;
  const eerste = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

  // Alleen een pagina uit de allowlist accepteren; een onbekende waarde valt
  // stil terug op de standaard in plaats van de viewer op een lege sleutel te
  // zetten waar nooit iets voor binnenkomt.
  const gevraagd = eerste(params.pagina);
  const startPagina = GEMETEN_PAGINAS.some((p) => p.key === gevraagd) ? gevraagd : undefined;

  const apparaatParam = eerste(params.apparaat);
  const startApparaat: Apparaat | undefined = isApparaat(apparaatParam) ? apparaatParam : undefined;

  const dagenParam = Number(eerste(params.dagen));
  const startDagen = Number.isFinite(dagenParam) && dagenParam > 0
    ? Math.min(365, Math.round(dagenParam))
    : undefined;

  return (
    <HeatmapViewer
      paginas={GEMETEN_PAGINAS}
      startPagina={startPagina}
      startApparaat={startApparaat}
      startDagen={startDagen}
    />
  );
}
