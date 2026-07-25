import { interpolate } from "@/lib/messages";

/**
 * Vaste FAQ-blokken per hoofdgroep — verlaagt twijfel op de PDP.
 *
 * De teksten lopen via de vertaalrail (lib/messages-catalog + de nachtelijke
 * vertaal-cron). Reden: dit blok wordt óók als FAQPage-JSON-LD uitgeserveerd, en
 * Google las op een pagina met lang="en" Nederlandse vragen/antwoorden. Verbergen
 * op /en /de is geen optie (dan verdwijnt de rich-result), dus vertalen we.
 *
 * De NL-brontekst blijft hier staan als vangnet: zolang een sleutel nog niet in
 * de catalogus zit geeft t() de sleutel zélf terug, en dan tonen we liever het
 * Nederlandse origineel dan "pdp.faq.common.returns.q".
 */
export type PdpFaq = { q: string; a: string };

/** Locale-gebonden vertaalfunctie (uit getT(locale) — de locale zit dus in `t`). */
export type FaqTranslate = (key: string, params?: Record<string, string | number>) => string;

/** `key` = sleutel-voorvoegsel in de vertaalrail; er horen een `.q` en een `.a` bij. */
type FaqSource = { key: string; q: string; a: string };

/** t() valt terug op de sleutel als die (nog) niet bestaat — dan de NL-bron tonen. */
function trOr(t: FaqTranslate | undefined, key: string, nl: string, vars?: Record<string, string | number>): string {
  const v = t?.(key, vars);
  // Ook de NL-vangnettekst krijgt zijn {placeholders} ingevuld — anders zou er
  // letterlijk "{days} dagen" staan zodra een sleutel nog niet in de catalogus zit.
  return v && v !== key ? v : interpolate(nl, vars);
}

const COMMON: FaqSource[] = [
  {
    key: "pdp.faq.common.returns",
    q: "Hoe werkt retourneren?",
    // Let op: geen "gratis en volledig bedrag terug" meer — dat botste met de
    // echte voorwaarde die elders op deze pagina staat (tegoed/winkel = gratis,
    // geld terug = retourkosten). Bedenktijd en bedrag komen als {days}/{amount}
    // uit returnConfig (Instellingen), niet uit deze tekst.
    a: "Je hebt {days} dagen bedenktijd. Kies je een GENTS-tegoed of lever je het in één van onze 19 winkels in, dan is retourneren gratis; wil je het bedrag terug op je rekening, dan rekenen we {amount} retourkosten.",
  },
  {
    key: "pdp.faq.common.delivery",
    q: "Wanneer is mijn bestelling in huis?",
    a: "Vóór 16:00 besteld is doorgaans de volgende werkdag in huis. Op werkdagen verzenden we dagelijks; bestellingen in het weekend gaan op maandag de deur uit.",
  },
  {
    key: "pdp.faq.common.fitting",
    q: "Kan ik in een winkel terecht voor pasadvies?",
    a: "Zeker. Onze stylisten staan in al onze 19 winkels voor je klaar — vrijblijvend en zonder afspraak. Voor pakken en bruiloften adviseren we wel een afspraak te maken.",
  },
];

const BY_HG: Record<string, FaqSource[]> = {
  Pakken: [
    {
      key: "pdp.faq.suits.fit",
      q: "Past dit pak slim of modern fit?",
      a: "Modern fit valt nét aangesloten zonder ergens te trekken. Slim fit is strakker (vooral op borst en taille). Twijfel je? Onze pasvorm-uitleg en maatadvies helpen je in een paar klikken.",
    },
    {
      key: "pdp.faq.suits.hem",
      q: "Kan ik de pijp laten innemen?",
      a: "Ja — in onze winkels nemen we de broekpijp voor je op met onze vermaakservice. Vraag ernaar bij het afhalen of bij je pasafspraak.",
    },
    ...COMMON,
  ],
  Colberts: [
    {
      key: "pdp.faq.jackets.size",
      q: "Hoe meet ik mijn colbertmaat?",
      a: "Colbertmaat = borstomvang / 2 (in cm). Onze maatadvies-tool rekent het automatisch om uit lengte en gewicht.",
    },
    {
      key: "pdp.faq.jackets.separate",
      q: "Kan ik dit colbert los van een broek dragen?",
      a: "Absoluut — alle Mix & Match-colberts zijn ontworpen om los of in een pak gedragen te worden. Combineer met een nette chino voor een smart-casual look.",
    },
    ...COMMON,
  ],
  Overhemden: [
    {
      key: "pdp.faq.shirts.noniron",
      q: "Is dit overhemd strijkvrij?",
      a: "Veel van onze overhemden zijn strijkvrij of easycare-behandeld. Kijk bij Specificaties op deze pagina voor de exacte stof- en onderhoudsinformatie.",
    },
    {
      key: "pdp.faq.shirts.collar",
      q: "Hoe zit de boordmaat?",
      a: "Onze boordmaten lopen van 37/38 (S) tot 49/50 (4XL). De maat is de halsomvang in cm. Voor langere mannen bieden we de 7-uitvoering met extra mouw- en lijflengte.",
    },
    ...COMMON,
  ],
  Smoking: [
    {
      key: "pdp.faq.tuxedo.shoes",
      q: "Welke schoenen draag ik bij een smoking?",
      a: "Klassiek: zwarte lakschoenen of suède loafers in zwart. Bij een dinnerjacket kan een suède gespschoen ook — onze etiquette-pagina legt het uit.",
    },
    ...COMMON,
  ],
  Schoenen: [
    {
      key: "pdp.faq.shoes.sizing",
      q: "Vallen deze schoenen normaal qua maat?",
      a: "Onze schoenmaten volgen de standaard Europese maatvoering. Tussen twee maten in? Kies in de regel de grootste, vooral bij leren modellen.",
    },
    ...COMMON,
  ],
};

/**
 * FAQ voor één hoofdgroep, in de taal van `t`. Geef altijd de t uit
 * `getT(locale)` mee — anders staat het blok (en het JSON-LD) weer in het
 * Nederlands op /en /de /fr /es. `vars` vult de {placeholders} (bv. de
 * bedenktijd en retourkosten uit de instellingen).
 */
export function faqFor(hoofdgroep: string, t?: FaqTranslate, vars?: Record<string, string | number>): PdpFaq[] {
  const src = BY_HG[hoofdgroep] || COMMON;
  return src.map((f) => ({
    q: trOr(t, `${f.key}.q`, f.q, vars),
    a: trOr(t, `${f.key}.a`, f.a, vars),
  }));
}
