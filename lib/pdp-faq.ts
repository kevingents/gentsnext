/** Vaste FAQ-blokken per hoofdgroep — verlaagt twijfel op de PDP. */
export type PdpFaq = { q: string; a: string };

const COMMON: PdpFaq[] = [
  { q: "Hoe werkt retourneren?", a: "Je kunt je bestelling gratis retourneren binnen 14 dagen — online of in één van onze 19 winkels. Bij retournering ontvang je het volledige bedrag terug." },
  { q: "Wanneer is mijn bestelling in huis?", a: "Vóór 16:00 besteld is doorgaans de volgende werkdag in huis. Op werkdagen verzenden we dagelijks; bestellingen in het weekend gaan op maandag de deur uit." },
  { q: "Kan ik in een winkel terecht voor pasadvies?", a: "Zeker. Onze stylisten staan in al onze 19 winkels voor je klaar — vrijblijvend en zonder afspraak. Voor pakken en bruiloften adviseren we een afspraak via /pages/trouw-afspraak." },
];

const BY_HG: Record<string, PdpFaq[]> = {
  Pakken: [
    { q: "Past dit pak slim of modern fit?", a: "Modern fit valt nét aangesloten zonder ergens te trekken. Slim fit is strakker (vooral op borst en taille). Twijfel je? Onze pasvorm-uitleg en maatadvies helpen je in een paar klikken." },
    { q: "Kan ik de pijp laten innemen?", a: "Ja — in onze winkels nemen we de broekpijp voor je op met onze vermaakservice. Vraag ernaar bij het afhalen of bij je pasafspraak." },
    ...COMMON,
  ],
  Colberts: [
    { q: "Hoe meet ik mijn colbertmaat?", a: "Colbertmaat = borstomvang / 2 (in cm). Onze maatadvies-tool rekent het automatisch om uit lengte en gewicht." },
    { q: "Kan ik dit colbert los van een broek dragen?", a: "Absoluut — alle Mix & Match-colberts zijn ontworpen om los of in een pak gedragen te worden. Combineer met een nette chino voor een smart-casual look." },
    ...COMMON,
  ],
  Overhemden: [
    { q: "Is dit overhemd strijkvrij?", a: "Veel van onze overhemden zijn strijkvrij of easycare-behandeld. Kijk bij Specificaties op deze pagina voor de exacte stof- en onderhoudsinformatie." },
    { q: "Hoe zit de boordmaat?", a: "Onze boordmaten lopen van 37/38 (S) tot 49/50 (4XL). De maat is de halsomvang in cm. Voor langere mannen bieden we de 7-uitvoering met extra mouw- en lijflengte." },
    ...COMMON,
  ],
  Smoking: [
    { q: "Welke schoenen draag ik bij een smoking?", a: "Klassiek: zwarte lakschoenen of suède loafers in zwart. Bij een dinnerjacket kan een suède gespschoen ook — onze etiquette-pagina legt het uit." },
    ...COMMON,
  ],
  Schoenen: [
    { q: "Vallen deze schoenen normaal qua maat?", a: "Onze schoenmaten volgen de standaard Europese maatvoering. Tussen twee maten in? Kies in de regel de grootste, vooral bij leren modellen." },
    ...COMMON,
  ],
};

export function faqFor(hoofdgroep: string): PdpFaq[] {
  return BY_HG[hoofdgroep] || COMMON;
}
