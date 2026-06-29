import type { ChartCategory } from "@/lib/size-chart";

/**
 * Maattabellen-hub: de SEO/UX-landingspagina's per categorie onder /maattabellen.
 * Bouwt voort op de autoritatieve GENTS-maatdata (lib/size-chart) en rendert die
 * als echte, semantische tabellen — vindbaar in Google (i.t.t. de tool /maatadvies,
 * die interactief is en niet als statische tabel indexeert).
 *
 * Pure module (geen server-imports) zodat zowel de server-pagina's als de PDP-
 * maattabel-knop (client) hieruit kunnen lezen. Inhoud staat bewust in code, net
 * als lib/etiquette-hub — kan later naar de content-store als de redactie het wil.
 */

export type Measure = "chest" | "waist" | "collar" | "inseam";

export const MEASURE_INFO: Record<Measure, { label: string; how: string }> = {
  chest: { label: "Borstomvang", how: "Meet rond het volste deel van je borst, onder de oksels door. Houd het meetlint horizontaal en niet te strak." },
  waist: { label: "Tailleomvang", how: "Meet rond je natuurlijke taille — net boven de heupbotten, daar waar je broek normaal zit." },
  collar: { label: "Boordmaat (halsomvang)", how: "Meet rond je hals, op de plek waar de boord komt te zitten, en houd één vinger ruimte aan." },
  inseam: { label: "Binnenbeenlengte", how: "Meet aan de binnenkant van je been, van het kruis tot de gewenste lengte van de broekspijp." },
};

export type SizeChartSpec = { category?: ChartCategory; boord?: boolean; caption: string };

export type SizeGuide = {
  slug: string;
  navLabel: string;
  title: string;
  cardDescription: string;
  seoTitle: string;
  seoDescription: string;
  intro: string;
  charts: SizeChartSpec[];
  measures: Measure[];
  categorySlug?: string;
  hoofdgroepen: string[];
  faqs: { q: string; a: string }[];
};

const FIT_NOTE =
  "Let op: onze maatvoering volgt niet de vuistregel 'borst ÷ 2'. Een GENTS-maat 50 past bijvoorbeeld bij een borstomvang van 107 cm. Kijk dus altijd in de tabel of gebruik het maatadvies.";
const TWEEN_FAQ = {
  q: "Wat als ik tussen twee maten val?",
  a: "Zit je er net tussenin? Kies dan de grotere maat voor draagcomfort, of laat de kleinere in de winkel op maat maken. Onze stylisten helpen je graag bij twijfel.",
};
const MEASURE_FAQ = {
  q: "Hoe meet ik mezelf op?",
  a: "Gebruik een zacht meetlint en meet over je ondergoed of een dun shirt. Borst: rond het volste deel onder de oksels. Taille: rond je natuurlijke taille. Twijfel je? Probeer het maatadvies of kom langs in de winkel.",
};

export const SIZE_GUIDES: SizeGuide[] = [
  {
    slug: "pakken",
    navLabel: "Pakken",
    title: "Maattabel pakken",
    cardDescription: "Borst, taille en binnenbeen per pakmaat (42–64).",
    seoTitle: "Maattabel pakken — vind jouw pakmaat | GENTS",
    seoDescription: "De officiële GENTS-maattabel voor pakken: lichaamsmaten in centimeters per confectiemaat (42 t/m 64). Vind in één oogopslag jouw pakmaat.",
    intro: "Een pak valt pas goed als de maat klopt. Hieronder vind je de officiële GENTS-maattabel voor pakken — van borst- en tailleomvang tot binnenbeenlengte, allemaal in centimeters. Meet jezelf op en zoek je maat op, of laat het maatadvies het voor je doen.",
    charts: [{ category: "Pakken (algemeen)", caption: "GENTS-pakmaten — lichaamsmaten in cm" }],
    measures: ["chest", "waist", "inseam"],
    categorySlug: "pakken",
    hoofdgroepen: ["Pakken"],
    faqs: [
      { q: "Welke pakmaat heb ik?", a: "Je pakmaat wordt bepaald door je borstomvang. Meet rond het volste deel van je borst en zoek de bijbehorende maat op in de tabel. " + FIT_NOTE },
      { q: "Valt GENTS groot of klein?", a: "Onze maatvoering wijkt bewust af van de standaard vuistregel. Reken niet met 'borst ÷ 2', maar lees je maat af in de tabel: een maat 50 hoort bijvoorbeeld bij 107 cm borst." },
      TWEEN_FAQ,
      MEASURE_FAQ,
    ],
  },
  {
    slug: "colberts",
    navLabel: "Colberts",
    title: "Maattabel colberts",
    cardDescription: "Borst en taille per colbertmaat (42–64).",
    seoTitle: "Maattabel colberts & blazers — jouw colbertmaat | GENTS",
    seoDescription: "GENTS-maattabel voor colberts en blazers: borst- en tailleomvang in centimeters per maat (42 t/m 64). Vind snel jouw colbertmaat.",
    intro: "Het colbert bepaalt de lijn van je outfit. In deze GENTS-maattabel lees je per maat de bijbehorende borst- en tailleomvang af, zodat je colbert precies goed op de schouders en rond de borst valt.",
    charts: [{ category: "Colberts (Standaard)", caption: "Colbertmaten — borst & taille in cm" }],
    measures: ["chest", "waist"],
    categorySlug: "colberts",
    hoofdgroepen: ["Colberts"],
    faqs: [
      { q: "Welke colbertmaat heb ik?", a: "De colbertmaat volgt je borstomvang. Meet rond het volste deel van je borst en zoek de maat op in de tabel. " + FIT_NOTE },
      { q: "Is de colbertmaat gelijk aan de pakmaat?", a: "Ja. Een los colbert en het colbert van een pak volgen dezelfde maatvoering. Bestel je los colbert en pantalon apart, dan kun je per onderdeel de juiste maat kiezen." },
      TWEEN_FAQ,
      MEASURE_FAQ,
    ],
  },
  {
    slug: "gilets",
    navLabel: "Gilets",
    title: "Maattabel gilets",
    cardDescription: "Het gilet volgt de colbertmaat — borst in cm.",
    seoTitle: "Maattabel gilets — jouw giletmaat | GENTS",
    seoDescription: "GENTS-maattabel voor gilets. Het gilet volgt de colbertmaat: vind jouw maat op basis van je borstomvang in centimeters.",
    intro: "Een gilet maakt elke look completer. Het gilet volgt dezelfde maatvoering als het colbert: kies je maat op basis van je borstomvang. Hieronder de bijbehorende lichaamsmaten in centimeters.",
    charts: [{ category: "Colberts (Standaard)", caption: "Giletmaten volgen de colbertmaat — borst & taille in cm" }],
    measures: ["chest", "waist"],
    categorySlug: "gilets",
    hoofdgroepen: ["Gilets"],
    faqs: [
      { q: "Welke giletmaat heb ik?", a: "Het gilet volgt de colbertmaat en dus je borstomvang. Meet rond het volste deel van je borst en zoek je maat op in de tabel." },
      { q: "Draag ik het gilet strak of ruim?", a: "Een gilet zit het mooist netjes aansluitend, zodat het onder een colbert niet bolt. De onderste knoop blijft altijd open." },
      TWEEN_FAQ,
    ],
  },
  {
    slug: "overhemden",
    navLabel: "Overhemden",
    title: "Maattabel overhemden",
    cardDescription: "Confectie ↔ boordmaat ↔ borst en taille.",
    seoTitle: "Maattabel overhemden — boordmaat berekenen | GENTS",
    seoDescription: "GENTS-maattabel voor overhemden: confectiemaat, boordmaat (halsomvang) en borst/taille in centimeters. Bereken eenvoudig jouw overhemdmaat.",
    intro: "Overhemden gaan op boordmaat: de halsomvang in centimeters. In deze tabel zie je hoe de confectiemaat (S, M, L…) zich verhoudt tot de boordmaat en je borst- en tailleomvang. Lange armen? Kies de 7-variant voor +5–6 cm mouwlengte.",
    charts: [{ boord: true, caption: "Overhemd: confectie ↔ boordmaat ↔ borst & taille" }],
    measures: ["collar", "chest"],
    categorySlug: "overhemden",
    hoofdgroepen: ["Overhemden"],
    faqs: [
      { q: "Hoe bereken ik mijn boordmaat?", a: "Meet rond je hals waar de boord komt te zitten en houd één vinger ruimte aan. De uitkomst in centimeters is je boordmaat — bijvoorbeeld 39–40 komt overeen met confectiemaat M." },
      { q: "Wat betekent de 7-variant?", a: "De 7-variant (bijvoorbeeld 'M7 39/40') heeft een langere mouw: +5–6 cm mouwlengte. Ideaal als je wat langere armen hebt." },
      { q: "Moet ik op boordmaat of op borst kiezen?", a: "Voor de pasvorm rond de hals is de boordmaat leidend. Klopt je boordmaat maar zit het rond de borst te strak of te ruim, kijk dan ook naar de borstkolom in de tabel." },
      TWEEN_FAQ,
    ],
  },
  {
    slug: "pantalons",
    navLabel: "Pantalons",
    title: "Maattabel pantalons",
    cardDescription: "Taille en binnenbeen — standaard, lengte- en kwartmaten.",
    seoTitle: "Maattabel pantalons & broeken — jouw broekmaat | GENTS",
    seoDescription: "GENTS-maattabel voor pantalons: taille en binnenbeenlengte in centimeters, inclusief lengtematen en kwartmaten. Vind jouw broekmaat.",
    intro: "Een pantalon kiezen we op taille én lengte. Hieronder de standaardmaten plus de lengte- en kwartmaten, zodat de broek niet alleen rond de taille klopt maar ook de juiste binnenbeenlengte heeft.",
    charts: [
      { category: "Pantalon (Standaard)", caption: "Pantalon (standaard) — taille & binnenbeen in cm" },
      { category: "Pantalon (Lang)", caption: "Pantalon (lengtematen) — voor de langere man" },
      { category: "Pantalon (Kwart)", caption: "Pantalon (kwartmaten) — tussenmaten" },
    ],
    measures: ["waist", "inseam"],
    categorySlug: "pantalons",
    hoofdgroepen: ["Broeken"],
    faqs: [
      { q: "Welke broekmaat heb ik?", a: "De pantalonmaat volgt je tailleomvang. Meet rond je natuurlijke taille en zoek de maat op. Voor de juiste lengte kijk je naar de binnenbeenlengte." },
      { q: "Wat betekenen kwart- en lengtematen?", a: "Lengtematen (88–118) zijn bedoeld voor de langere man met meer binnenbeenlengte; kwartmaten zijn tussenmaten in de taille. Zo vind je een broek die zowel in taille als lengte klopt." },
      { q: "Hoe meet ik mijn binnenbeenlengte?", a: "Meet aan de binnenkant van je been, van het kruis tot de gewenste lengte van de broekspijp. Gebruik eventueel een broek die je goed zit als referentie." },
      TWEEN_FAQ,
    ],
  },
  {
    slug: "truien",
    navLabel: "Truien & vesten",
    title: "Maattabel truien & vesten",
    cardDescription: "Borst per maat (S t/m 3XL).",
    seoTitle: "Maattabel truien & vesten — jouw maat | GENTS",
    seoDescription: "GENTS-maattabel voor truien en vesten: borstomvang in centimeters per maat (S t/m 3XL). Vind snel je trui- of vestmaat.",
    intro: "Truien en vesten gaan op lettermaten (S, M, L…). In deze tabel lees je per maat de bijbehorende borstomvang af, voor een trui die comfortabel zit zonder te bollen.",
    charts: [{ category: "Truien", caption: "Trui- en vestmaten — borst & taille in cm" }],
    measures: ["chest"],
    categorySlug: "truien",
    hoofdgroepen: ["Truien"],
    faqs: [
      { q: "Welke truimaat heb ik?", a: "De truimaat volgt je borstomvang. Meet rond het volste deel van je borst en zoek de bijbehorende lettermaat op in de tabel." },
      { q: "Kan ik een trui over een overhemd dragen?", a: "Ja. Draag je de trui vaak over een overhemd, kies dan eventueel een maat ruimer voor extra bewegingsruimte." },
      TWEEN_FAQ,
    ],
  },
  {
    slug: "poloshirts",
    navLabel: "Poloshirts",
    title: "Maattabel poloshirts",
    cardDescription: "Borst per maat (S t/m 4XL).",
    seoTitle: "Maattabel poloshirts — jouw polomaat | GENTS",
    seoDescription: "GENTS-maattabel voor poloshirts: borstomvang in centimeters per maat (S t/m 4XL). Vind snel jouw polomaat.",
    intro: "Poloshirts gaan op lettermaten. Hieronder de borstomvang per maat in centimeters, zodat je polo netjes aansluit zonder te spannen.",
    charts: [{ category: "Poloshirts", caption: "Polomaten — borst & taille in cm" }],
    measures: ["chest"],
    hoofdgroepen: ["Polo-shirts", "Poloshirts"],
    faqs: [
      { q: "Welke polomaat heb ik?", a: "De polomaat volgt je borstomvang. Meet rond het volste deel van je borst en zoek de bijbehorende lettermaat op in de tabel." },
      TWEEN_FAQ,
    ],
  },
];

const BY_SLUG = new Map(SIZE_GUIDES.map((g) => [g.slug, g]));
export function guideBySlug(slug: string): SizeGuide | null {
  return BY_SLUG.get(slug) ?? null;
}

const HG_TO_SLUG = new Map<string, string>();
for (const g of SIZE_GUIDES) for (const hg of g.hoofdgroepen) HG_TO_SLUG.set(hg.toLowerCase(), g.slug);
/** Catalogus-hoofdgroep → maattabel-slug (voor de "Uitgebreide maatinformatie"-link op PDP). */
export function hubSlugForHoofdgroep(hoofdgroep: string): string | null {
  const h = (hoofdgroep || "").toLowerCase().trim();
  if (HG_TO_SLUG.has(h)) return HG_TO_SLUG.get(h)!;
  if (h.includes("overhemd")) return "overhemden";
  if (h.includes("pak")) return "pakken";
  if (h.includes("colbert") || h.includes("blazer")) return "colberts";
  if (h.includes("gilet")) return "gilets";
  if (h.includes("broek") || h.includes("pantalon")) return "pantalons";
  if (h.includes("polo")) return "poloshirts";
  if (h.includes("trui") || h.includes("vest") || h.includes("sweat")) return "truien";
  return null;
}
