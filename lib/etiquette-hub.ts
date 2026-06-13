/**
 * Etiquette-hub: ingang naar de 8 dresscode-pagina's, gegroepeerd op formaliteit.
 * Verwijst naar /pages/<handle>, waar de gemigreerde of Sanity-content staat.
 */
export type EtiquetteItem = {
  handle: string;
  title: string;
  description: string;
  image: string;
};

export const ETIQUETTE: EtiquetteItem[] = [
  {
    handle: "white-tie-etiquette",
    title: "White tie",
    description: "Het meest formele tenue: rokkostuum, witte vlinderdas. Voor staatsbanketten en gala's.",
    image: "/brand/brand-impression-gala.jpg",
  },
  {
    handle: "black-tie-etiquette",
    title: "Black tie",
    description: "Smoking met zwarte vlinderdas — het klassieke tenue voor gala's en avondevenementen.",
    image: "/brand/brand-model-tuxedo.jpg",
  },
  {
    handle: "gala-etiquette",
    title: "Gala",
    description: "Wat draag je naar een studentengala of bedrijfsgala? De regels en alternatieven.",
    image: "/brand/brand-model-grey3piece.jpg",
  },
  {
    handle: "jacquet-en-de-morning-coat-etiquette",
    title: "Jacquet / morning coat",
    description: "De traditionele ochtendoutfit voor bruiloften en plechtigheden.",
    image: "/brand/brand-impression-wedding.jpg",
  },
  {
    handle: "promovendus-etiquette",
    title: "Promovendus",
    description: "Het juiste tenue voor de academische promotie — rokkostuum of jacquet, met de details die kloppen.",
    image: "/brand/brand-model-charcoal.jpg",
  },
  {
    handle: "tenue-de-ville-etiquette",
    title: "Tenue de ville",
    description: "Het zakelijke standaardtenue: net pak in donkere kleur, voor formele zakelijke gelegenheden.",
    image: "/brand/brand-impression-interview.jpg",
  },
  {
    handle: "smart-casual-etiquette",
    title: "Smart casual",
    description: "Verzorgd maar zonder stropdas. Colbert met chino of nette jeans — moeiteloos elegant.",
    image: "/brand/brand-model-tan.jpg",
  },
  {
    handle: "trouwen-met-gents",
    title: "Trouwen met GENTS",
    description: "Bruidegom, getuige of gast: ons complete advies voor het bruiloftspak.",
    image: "/brand/brand-model-navy.jpg",
  },
];
