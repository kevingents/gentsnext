import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
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
  const params = await searchParams;
  const eerste = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

  /* Eerst valideren, dan pas gebruiken — zowel voor de viewer als voor het
     terugkeerpad hieronder. Alleen een pagina uit de allowlist telt; een
     onbekende waarde valt stil terug op de standaard in plaats van de viewer op
     een sleutel te zetten waar nooit iets voor binnenkomt. */
  const gevraagd = eerste(params.pagina);
  const startPagina = GEMETEN_PAGINAS.some((p) => p.key === gevraagd) ? gevraagd : undefined;

  const apparaatParam = eerste(params.apparaat);
  const startApparaat: Apparaat | undefined = isApparaat(apparaatParam) ? apparaatParam : undefined;

  const dagenParam = Number(eerste(params.dagen));
  const startDagen = Number.isFinite(dagenParam) && dagenParam > 0
    ? Math.min(365, Math.round(dagenParam))
    : undefined;

  const customer = await getSessionCustomer().catch(() => null);

  /*
   * NIET INGELOGD ≠ GEEN TOEGANG. Deze twee liepen hier door elkaar en dat gaf
   * precies het verkeerde antwoord: de portal linkt hierheen, maar wie in de
   * portal werkt heeft op gents.nl zélf meestal geen sessie — dat is een ander
   * domein met een eigen inlog. Die kreeg dus een kaal "404 This page could not
   * be found", zonder enige aanwijzing dat inloggen de oplossing was.
   *
   * Nu: geen sessie → naar de inlog, mét terugkeerpad, zodat de magic-link je
   * op precies deze heatmap terugzet (de keten login → verify → next
   * ondersteunt dat al). Wél ingelogd maar geen beheerder → 404 blijft, want
   * een gewone klant hoeft niet te weten dat dit bestaat.
   *
   * In het terugkeerpad gaan alleen de GEVALIDEERDE waarden mee. Een verzonnen
   * `?pagina=/bestelling/GN-99999` negeren we toch al, maar zonder deze filter
   * reist hij wél mee de login-URL in en daarmee de serverlogs in. Niets
   * doorgeven wat je vervolgens weggooit.
   */
  if (!customer) {
    const q = new URLSearchParams();
    if (startPagina) q.set("pagina", startPagina);
    if (startApparaat) q.set("apparaat", startApparaat);
    if (startDagen) q.set("dagen", String(startDagen));
    const terug = q.toString() ? `/heatmap?${q.toString()}` : "/heatmap";
    redirect(`/account/login?next=${encodeURIComponent(terug)}`);
  }
  if (!customer.isAdmin) notFound();

  return (
    <HeatmapViewer
      paginas={GEMETEN_PAGINAS}
      startPagina={startPagina}
      startApparaat={startApparaat}
      startDagen={startDagen}
    />
  );
}
