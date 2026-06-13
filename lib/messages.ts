import type { Locale } from "@/lib/i18n";

/**
 * UI-teksten per taal. Ontbrekende sleutels/talen vallen terug op Nederlands,
 * zodat de site nooit "leeg" of stuk is tijdens het uitrollen van vertalingen.
 */

type Dict = Record<string, string>;

const nl: Dict = {
  "usp.specialist": "Formele-momenten specialist",
  "usp.luxury": "Betaalbare luxe",
  "usp.returns": "Gratis retour binnen 14 dagen",
  "usp.advice": "Persoonlijk advies in 19 winkels",
  "nav.suitBuilder": "Pak samenstellen",
  "nav.sizeAdvice": "Maatadvies",
  "cart.title": "Winkelwagen",
  "cart.empty": "Je winkelwagen is leeg",
  "cart.checkout": "Afrekenen",
  "cart.subtotal": "Subtotaal",
  "cart.freeShipping": "Je komt in aanmerking voor gratis verzending",
  "common.addToCart": "In winkelwagen",
  "common.chooseSize": "Kies een maat",
  "common.soldOut": "Uitverkocht",
  "common.inStock": "Op voorraad",
  "common.shopNow": "Shop nu",
  "common.viewAll": "Bekijk alles",
  "common.search": "Zoeken",
  "common.account": "Mijn account",
  "common.wishlist": "Favorieten",
  "footer.shop": "Shoppen",
  "footer.service": "Service",
  "footer.legal": "Juridisch",
  "footer.newsletterTitle": "Nieuwe collecties, styling-tips en exclusieve aanbiedingen",
  "footer.newsletterCta": "Inschrijven",
  "delivery.beforeCutoff": "Voor 16:00 besteld, vandaag verzonden",
  "delivery.free": "Gratis verzending vanaf € 75",
};

const en: Dict = {
  "usp.specialist": "Formalwear specialists",
  "usp.luxury": "Affordable luxury",
  "usp.returns": "Free returns within 14 days",
  "usp.advice": "Personal advice in 19 stores",
  "nav.suitBuilder": "Build your suit",
  "nav.sizeAdvice": "Size advice",
  "cart.title": "Cart",
  "cart.empty": "Your cart is empty",
  "cart.checkout": "Checkout",
  "cart.subtotal": "Subtotal",
  "cart.freeShipping": "You qualify for free shipping",
  "common.addToCart": "Add to cart",
  "common.chooseSize": "Choose a size",
  "common.soldOut": "Sold out",
  "common.inStock": "In stock",
  "common.shopNow": "Shop now",
  "common.viewAll": "View all",
  "common.search": "Search",
  "common.account": "My account",
  "common.wishlist": "Wishlist",
  "footer.shop": "Shop",
  "footer.service": "Service",
  "footer.legal": "Legal",
  "footer.newsletterTitle": "New collections, styling tips and exclusive offers",
  "footer.newsletterCta": "Subscribe",
  "delivery.beforeCutoff": "Order before 4 PM, shipped today",
  "delivery.free": "Free shipping from € 75",
};

const de: Dict = {
  "usp.specialist": "Spezialist für formelle Anlässe",
  "usp.luxury": "Bezahlbarer Luxus",
  "usp.returns": "Kostenlose Rückgabe innerhalb von 14 Tagen",
  "usp.advice": "Persönliche Beratung in 19 Geschäften",
  "nav.suitBuilder": "Anzug zusammenstellen",
  "nav.sizeAdvice": "Größenberatung",
  "cart.title": "Warenkorb",
  "cart.empty": "Dein Warenkorb ist leer",
  "cart.checkout": "Zur Kasse",
  "cart.subtotal": "Zwischensumme",
  "cart.freeShipping": "Du erhältst kostenlosen Versand",
  "common.addToCart": "In den Warenkorb",
  "common.chooseSize": "Größe wählen",
  "common.soldOut": "Ausverkauft",
  "common.inStock": "Auf Lager",
  "common.shopNow": "Jetzt shoppen",
  "common.viewAll": "Alle ansehen",
  "common.search": "Suchen",
  "common.account": "Mein Konto",
  "common.wishlist": "Merkliste",
  "footer.shop": "Shop",
  "footer.service": "Service",
  "footer.legal": "Rechtliches",
  "footer.newsletterTitle": "Neue Kollektionen, Styling-Tipps und exklusive Angebote",
  "footer.newsletterCta": "Abonnieren",
  "delivery.beforeCutoff": "Vor 16 Uhr bestellt, heute versendet",
  "delivery.free": "Kostenloser Versand ab 75 €",
};

const DICTS: Record<Locale, Dict> = { nl, en, de, fr: {}, es: {} };

export function t(key: string, locale: Locale): string {
  return DICTS[locale]?.[key] ?? nl[key] ?? key;
}

/** Hele woordenboek voor een locale (voor de client-provider). */
export function messagesFor(locale: Locale): Dict {
  return { ...nl, ...(DICTS[locale] || {}) };
}
