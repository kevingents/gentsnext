/**
 * Storytelling-landingspagina's per gelegenheid. De Shopify-varianten waren met
 * theme-secties gebouwd (lege page-body), dus hier opnieuw opgebouwd in de
 * GENTS-tone: warm, deskundig, gericht op de gelegenheid i.p.v. de doelgroep.
 */
export type LandingSection = {
  title: string;
  body: string;
  image?: string;
};
export type Landing = {
  handle: string;
  eyebrow: string;
  title: string;
  intro: string;
  heroImage: string;
  sections: LandingSection[];
  shop: { label: string; href: string }[];
  cta: { label: string; href: string };
  seoDescription: string;
};

export const LANDINGS: Record<string, Landing> = {
  zakelijk: {
    handle: "zakelijk",
    eyebrow: "GENTS Zakelijk",
    title: "Professioneel voor de dag komen",
    intro:
      "Of het nu gaat om een belangrijke meeting, een presentatie of het aankleden van een heel team — wij zorgen dat u en uw collega's er verzorgd en zelfverzekerd bijlopen. Betaalbare kwaliteit, persoonlijk advies en een pasvorm die klopt.",
    heroImage: "/brand/brand-impression-interview.jpg",
    sections: [
      {
        title: "Het zakelijke pak",
        body: "Tijdloze kostuums in navy, antraciet en grijs die jaren meegaan. Comfortabele stoffen met stretch voor lange werkdagen, en een moderne pasvorm die net zo goed in de boardroom als op kantoor staat.",
        image: "/brand/brand-model-charcoal.jpg",
      },
      {
        title: "Overhemden die het verschil maken",
        body: "Van strijkvrije business-overhemden tot verfijnde details. Combineer ze met een bijpassende stropdas of pochet voor dat extra beetje autoriteit.",
        image: "/brand/brand-product-fabric.jpg",
      },
      {
        title: "Kleding voor je hele team",
        body: "Eén consistente uitstraling voor je bedrijf? Wij denken graag mee over bedrijfskleding en team-styling, met scherpe afspraken en persoonlijk advies in onze winkels.",
      },
    ],
    shop: [
      { label: "Business pakken", href: "/collections/mix-match-pakken" },
      { label: "Business overhemden", href: "/collections/business-overhemden" },
      { label: "Colberts", href: "/collections/colberts" },
      { label: "Stropdassen", href: "/collections/stropdassen" },
    ],
    cta: { label: "Bekijk de zakelijke collectie", href: "/collections/mix-match-pakken" },
    seoDescription:
      "GENTS Zakelijk — pakken, overhemden en accessoires voor elke professionele gelegenheid en voor je hele team. Betaalbare kwaliteit met persoonlijk advies.",
  },

  uitvaartkleding: {
    handle: "uitvaartkleding",
    eyebrow: "Uitvaart",
    title: "Gepast gekleed op een moeilijk moment",
    intro:
      "Afscheid nemen vraagt om sobere, respectvolle kleding — zonder dat u zich er druk om hoeft te maken. Onze medewerkers helpen u rustig en deskundig aan een passende, ingetogen outfit. Vaak nog dezelfde dag mee te nemen uit de winkel.",
    heroImage: "/brand/brand-impression-funeral.jpg",
    sections: [
      {
        title: "Ingetogen en correct",
        body: "Donkere kostuums in zwart en antraciet, met bijpassende overhemden en een sobere stropdas. Klassiek en tijdloos, geschikt voor de plechtigheid en daarna.",
        image: "/brand/brand-model-charcoal.jpg",
      },
      {
        title: "Snel geholpen",
        body: "We begrijpen dat tijd vaak kort is. In onze winkels staan we voor u klaar met direct leverbare maten en, waar nodig, snelle vermaakservice.",
      },
    ],
    shop: [
      { label: "Pakken", href: "/collections/pakken" },
      { label: "Colberts", href: "/collections/colberts" },
      { label: "Overhemden", href: "/collections/overhemden" },
      { label: "Stropdassen", href: "/collections/stropdassen" },
    ],
    cta: { label: "Bekijk pakken", href: "/collections/pakken" },
    seoDescription:
      "Sobere, respectvolle uitvaartkleding bij GENTS. Donkere pakken, overhemden en accessoires, met rustig en deskundig advies — vaak dezelfde dag mee te nemen.",
  },

  students: {
    handle: "students",
    eyebrow: "Studenten & verenigingen",
    title: "Onmisbaar bij elke galaktie en dispuutsavond",
    intro:
      "Van rokkostuum tot jacquet, van kroegjasje tot het complete galatenue — GENTS is dé specialist voor studenten en studentenverenigingen. Scherpe prijzen, kennis van alle dresscodes en speciale afspraken voor verenigingen.",
    heroImage: "/brand/brand-impression-peaky.jpg",
    sections: [
      {
        title: "Het rokkostuum & jacquet",
        body: "Voor het echte galawerk: rokkostuums en jacquets die zitten als gegoten. Wij kennen de regels van white tie en morning dress als geen ander en helpen je aan het juiste tenue.",
        image: "/brand/brand-model-tuxedo.jpg",
      },
      {
        title: "Kroegjasjes op maat",
        body: "Het kroegjasje van je vereniging in de juiste kleur en met de juiste details. Vraag naar onze mogelijkheden voor verenigingen — ook in grotere aantallen.",
      },
      {
        title: "Speciaal voor verenigingen",
        body: "Plan een afspraak met je dispuut, jaarclub of bestuur. We regelen graag een moment met persoonlijk advies en scherpe verenigingsvoorwaarden.",
      },
    ],
    shop: [
      { label: "Rokkostuums", href: "/collections/rokkostuum" },
      { label: "Jacquets", href: "/collections/jacquets" },
      { label: "Kroegjasjes", href: "/collections/kroegjasjes" },
      { label: "Smoking", href: "/collections/smoking" },
    ],
    cta: { label: "Bekijk gala & smoking", href: "/collections/gala" },
    seoDescription:
      "GENTS voor studenten en studentenverenigingen: rokkostuums, jacquets, kroegjasjes en galakleding. Scherpe prijzen, dresscode-expertise en verenigingsafspraken.",
  },
};

export function getLanding(handle: string): Landing | null {
  return LANDINGS[handle] ?? null;
}
