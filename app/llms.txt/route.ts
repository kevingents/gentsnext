import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-static";

/**
 * llms.txt — gestructureerde sitebeschrijving voor AI-crawlers (Perplexity,
 * ChatGPT, Claude, Google AI Overviews). Helpt taalmodellen onze content
 * correct te citeren met links naar de juiste pagina's.
 */
export async function GET() {
  const url = getSiteUrl();
  const body = `# GENTS Herenmode

> Nederlandse specialist in herenmode voor formele momenten — pakken, overhemden, smoking, accessoires en schoenen. 19 fysieke winkels in Nederland en België, plus online via gents.nl. Tagline: "Suits You".

GENTS is dé Nederlandse formele-momenten-specialist. Wij verkopen pakken, colberts, pantalons, overhemden, smokings, gilets, jassen, truien, polo's, stropdassen, pochets, riemen, schoenen en andere herenmode-accessoires. Onze positionering: betaalbare luxe, persoonlijk advies en dresscode-expertise.

## Belangrijkste pagina's

- [Homepage](${url}/): Overzicht assortiment, gelegenheden, nieuwste collecties
- [Onze winkels](${url}/pages/winkels): Alle 19 fysieke winkels met openingstijden
- [Pak samenstellen](${url}/pak-samenstellen): Stel je eigen 2- of 3-delig pak samen
- [Maatadvies](${url}/maatadvies): Online maatcalculator voor colbert-/lengte-/boordmaat
- [Etiquette & dresscodes](${url}/pages/etiquette): Gids voor black tie, white tie, gala, smart casual, tenue de ville, jacquet, promovendus
- [Klantenservice](${url}/pages/service): Service- en hulppagina
- [Retourneren](${url}/pages/retourneren): 14 dagen gratis retour
- [Bezorging & levertijd](${url}/pages/bezorgkosten-levertijden): Gratis verzending vanaf €75
- [Over GENTS](${url}/pages/over-gents): Bedrijfsverhaal
- [Trouwen met GENTS](${url}/pages/trouwen-met-gents): Bruidsmode-advies

## Hoofdcategorieën

- [Pakken](${url}/categorie/pakken)
- [Colberts](${url}/categorie/colberts)
- [Pantalons](${url}/categorie/pantalons)
- [Overhemden](${url}/categorie/overhemden)
- [Gilets](${url}/categorie/gilets)
- [Stropdassen](${url}/categorie/stropdassen)
- [Schoenen](${url}/categorie/schoenen)

## Dresscodes (beheerd door onze stylisten)

- [Black tie](${url}/pages/black-tie-etiquette)
- [White tie](${url}/pages/white-tie-etiquette)
- [Gala](${url}/pages/gala-etiquette)
- [Smart casual](${url}/pages/smart-casual-etiquette)
- [Tenue de ville](${url}/pages/tenue-de-ville-etiquette)
- [Jacquet / morning coat](${url}/pages/jacquet-en-de-morning-coat-etiquette)
- [Promovendus](${url}/pages/promovendus-etiquette)

## Service

- 19 fysieke winkels in Nederland en België met persoonlijk advies
- Gratis retour binnen 14 dagen
- Gratis verzending vanaf €75
- Voor 16:00 besteld = vandaag verzonden
- Veilig betalen met iDEAL
- Maatadvies online en in elke winkel
- Pasvorm-expertise voor pakken, colberts en overhemden
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
