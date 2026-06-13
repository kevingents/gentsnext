/**
 * Hoofdmenu — exact overgenomen uit de Shopify "Main menu" (handle
 * new-mainmenu). URLs 1:1 op /collections/<handle> en /pages/<handle> zodat de
 * structuur én de links overeenkomen met de huidige gents.nl.
 *
 * href "#" = alleen een dropdown-kop (geen eigen pagina), zoals in Shopify.
 */
export type MenuLink = { label: string; href: string };
export type MenuItem = { label: string; href: string; children?: MenuLink[] };

export const MAIN_MENU: MenuItem[] = [
  { label: "New arrivals", href: "/collections/nieuwe-collectie-gents" },
  {
    label: "Collecties",
    href: "#",
    children: [
      { label: "The Blumfontain collectie", href: "/collections/the-blumfontain-collectie" },
      { label: "The Daily basics", href: "/collections/the-basics" },
      { label: "The Linnenblend collectie", href: "/products/pak-linnenblend-strandzand-1" },
    ],
  },
  {
    label: "Herenkleding",
    href: "#",
    children: [
      { label: "Overhemden", href: "/collections/overhemden" },
      { label: "Korte mouwen overhemden", href: "/collections/korte-mouwen-overhemden" },
      { label: "Basic overhemden", href: "/collections/basic-overhemden" },
      { label: "Pakken", href: "/collections/pakken" },
      { label: "Colberts", href: "/collections/colberts" },
      { label: "Broeken", href: "/collections/broeken" },
      { label: "Gilets", href: "/collections/gilets" },
      { label: "Jassen", href: "/collections/jassen" },
      { label: "Truien & Vesten", href: "/collections/truien-en-vesten" },
      { label: "Poloshirts", href: "/collections/polos-en-shirts" },
    ],
  },
  {
    label: "Accessoires",
    href: "#",
    children: [
      { label: "Stropdassen", href: "/collections/stropdassen" },
      { label: "Strikken", href: "/collections/strikken" },
      { label: "Riemen", href: "/collections/riemen" },
      { label: "Pochets", href: "/collections/pochets" },
      { label: "Manchetknopen", href: "/collections/manchetknopen" },
      { label: "Dasspelden", href: "/collections/dasspelden" },
      { label: "Bretels", href: "/collections/bretels" },
      { label: "Boxershorts", href: "/collections/ondergoed" },
      { label: "Ondershirts", href: "/collections/t-shirt" },
      { label: "Sokken", href: "/collections/sokken" },
    ],
  },
  {
    label: "Schoenen",
    href: "/collections/schoenen",
    children: [
      { label: "Gespschoenen", href: "/collections/schoenen" },
      { label: "Lakschoenen", href: "/collections/schoenen" },
      { label: "Loafers", href: "/collections/schoenen" },
      { label: "Sneakers", href: "/collections/schoenen" },
      { label: "Veterschoenen", href: "/collections/schoenen" },
    ],
  },
  { label: "Gifts", href: "/collections/gifts" },
  {
    label: "Gala & Smoking",
    href: "/collections/gala",
    children: [
      { label: "Smoking", href: "/collections/smoking" },
      { label: "Dinnerjackets", href: "/collections/dinner-jacket" },
      { label: "Rokkostuum", href: "/collections/rokkostuum" },
      { label: "Jacquet", href: "/collections/jacquets" },
    ],
  },
  {
    label: "Trouwen",
    href: "#",
    children: [
      { label: "Trouwpakken", href: "/collections/trouwen" },
      { label: "Trouwaccessoires", href: "/collections/trouw-accessoires" },
      { label: "Trouwafspraak maken", href: "/pages/trouw-afspraak" },
    ],
  },
  {
    label: "Dresscodes",
    href: "/pages/etiquette",
    children: [
      { label: "Overzicht", href: "/pages/etiquette" },
      { label: "Black tie", href: "/pages/black-tie-etiquette" },
      { label: "White tie", href: "/pages/white-tie-etiquette" },
      { label: "Gala", href: "/pages/gala-etiquette" },
      { label: "Smart casual", href: "/pages/smart-casual-etiquette" },
      { label: "Jacquet / morning coat", href: "/pages/jacquet-en-de-morning-coat-etiquette" },
      { label: "Tenue de ville", href: "/pages/tenue-de-ville-etiquette" },
      { label: "Promovendus", href: "/pages/promovendus-etiquette" },
    ],
  },
  {
    label: "Business",
    href: "/collections/mix-match-pakken",
    children: [
      { label: "Business pakken", href: "/collections/mix-match-pakken" },
      { label: "Business overhemden", href: "/collections/business-overhemden" },
    ],
  },
  {
    label: "Students",
    href: "/collections/rokkostuum",
    children: [
      { label: "Rokkostuums", href: "/collections/rokkostuum" },
      { label: "Jacquets", href: "/collections/jacquets" },
      { label: "Kroegjasjes", href: "/collections/kroegjasjes" },
      { label: "Dames", href: "/collections/dames" },
      { label: "Voor Studentenverenigingen", href: "/pages/students" },
    ],
  },
  { label: "Outlet", href: "/collections/sale" },
  { label: "STORES", href: "/pages/winkels" },
];
