/**
 * Hoofdmenu — heringedeeld van 14 losse items naar 6 sterke groepen
 * (gelegenheid-first, conform de GENTS-positionering). Elke groep heeft
 * kolommen + een sfeer-tegel met beeld voor het mega-menu. "#" = alleen kop.
 */
export type MenuLink = { label: string; href: string };
export type MenuColumn = { title?: string; links: MenuLink[] };
export type MenuFeature = { label: string; caption?: string; href: string; image: string };
export type MenuItem = {
  label: string;
  href: string;
  columns?: MenuColumn[];
  features?: MenuFeature[];
};

export const MAIN_MENU: MenuItem[] = [
  { label: "Nieuw", href: "/collections/nieuwe-collectie-gents" },
  {
    label: "Kleding",
    href: "#",
    columns: [
      {
        title: "Pakken & colberts",
        links: [
          { label: "Pakken", href: "/collections/pakken" },
          { label: "Colberts", href: "/collections/colberts" },
          { label: "Gilets", href: "/collections/gilets" },
          { label: "Pak samenstellen", href: "/pak-samenstellen" },
        ],
      },
      {
        title: "Shirts & truien",
        links: [
          { label: "Overhemden", href: "/collections/overhemden" },
          { label: "Korte mouwen", href: "/collections/korte-mouwen-overhemden" },
          { label: "Polo's & shirts", href: "/collections/polos-en-shirts" },
          { label: "Truien & vesten", href: "/collections/truien-en-vesten" },
        ],
      },
      {
        title: "Broeken & jassen",
        links: [
          { label: "Broeken", href: "/collections/broeken" },
          { label: "Jassen", href: "/collections/jassen" },
        ],
      },
    ],
    features: [
      { label: "Nieuwe collectie", caption: "Net binnen", href: "/collections/nieuwe-collectie-gents", image: "/brand/brand-model-navy.jpg" },
    ],
  },
  {
    label: "Gelegenheden",
    href: "#",
    columns: [
      {
        title: "Bruiloft",
        links: [
          { label: "Trouwpakken", href: "/collections/trouwen" },
          { label: "Trouwaccessoires", href: "/collections/trouw-accessoires" },
          { label: "Afspraak maken", href: "/afspraak" },
        ],
      },
      {
        title: "Gala & Black Tie",
        links: [
          { label: "Smoking", href: "/collections/smoking" },
          { label: "Dinnerjackets", href: "/collections/dinner-jacket" },
          { label: "Rokkostuum", href: "/collections/rokkostuum" },
          { label: "Jacquet", href: "/collections/jacquets" },
        ],
      },
      {
        title: "Zakelijk & studie",
        links: [
          { label: "Business pakken", href: "/collections/mix-match-pakken" },
          { label: "Business overhemden", href: "/collections/business-overhemden" },
          { label: "Voor studenten", href: "/pages/students" },
        ],
      },
    ],
    features: [
      { label: "Dresscodes", caption: "Van black tie tot smart casual", href: "/pages/etiquette", image: "/brand/brand-impression-gala.jpg" },
    ],
  },
  {
    label: "Accessoires",
    href: "#",
    columns: [
      {
        title: "Accessoires",
        links: [
          { label: "Stropdassen", href: "/collections/stropdassen" },
          { label: "Strikken", href: "/collections/strikken" },
          { label: "Pochets", href: "/collections/pochets" },
          { label: "Riemen", href: "/collections/riemen" },
          { label: "Manchetknopen", href: "/collections/manchetknopen" },
          { label: "Bretels", href: "/collections/bretels" },
        ],
      },
      {
        title: "Schoenen",
        links: [
          { label: "Veterschoenen", href: "/collections/schoenen" },
          { label: "Lakschoenen", href: "/collections/schoenen" },
          { label: "Loafers", href: "/collections/schoenen" },
          { label: "Gespschoenen", href: "/collections/schoenen" },
        ],
      },
      {
        title: "Meer",
        links: [
          { label: "Sokken", href: "/collections/sokken" },
          { label: "Ondergoed", href: "/collections/ondergoed" },
          { label: "Gifts", href: "/collections/gifts" },
        ],
      },
    ],
    features: [
      { label: "Maak het af", caption: "De juiste details", href: "/collections/stropdassen", image: "/brand/brand-model-grey3piece.jpg" },
    ],
  },
  { label: "Looks", href: "/looks" },
  { label: "Sale", href: "/collections/sale" },
];
