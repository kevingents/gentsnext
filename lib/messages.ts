import type { Locale } from "@/lib/i18n";
import { SITE_CATALOG } from "@/lib/messages-catalog";

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
  "cart.title": "Tas",
  "cart.empty": "Je tas is nog leeg",
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
  "cart.title": "Bag",
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

const fr: Dict = {
  "usp.specialist": "Spécialiste des occasions formelles",
  "usp.luxury": "Luxe abordable",
  "usp.returns": "Retours gratuits sous 14 jours",
  "usp.advice": "Conseils personnalisés dans 19 magasins",
  "nav.suitBuilder": "Composez votre costume",
  "nav.sizeAdvice": "Guide des tailles",
  "cart.title": "Panier",
  "cart.empty": "Votre panier est vide",
  "cart.checkout": "Commander",
  "cart.subtotal": "Sous-total",
  "cart.freeShipping": "Vous bénéficiez de la livraison gratuite",
  "common.addToCart": "Ajouter au panier",
  "common.chooseSize": "Choisissez une taille",
  "common.soldOut": "Épuisé",
  "common.inStock": "En stock",
  "common.shopNow": "Acheter",
  "common.viewAll": "Voir tout",
  "common.search": "Rechercher",
  "common.account": "Mon compte",
  "common.wishlist": "Favoris",
  "footer.shop": "Boutique",
  "footer.service": "Service",
  "footer.legal": "Mentions légales",
  "footer.newsletterTitle": "Nouvelles collections, conseils de style et offres exclusives",
  "footer.newsletterCta": "S'inscrire",
  "delivery.beforeCutoff": "Commandé avant 16h, expédié aujourd'hui",
  "delivery.free": "Livraison gratuite dès 75 €",
};

const es: Dict = {
  "usp.specialist": "Especialistas en ropa formal",
  "usp.luxury": "Lujo asequible",
  "usp.returns": "Devoluciones gratis en 14 días",
  "usp.advice": "Asesoramiento personal en 19 tiendas",
  "nav.suitBuilder": "Crea tu traje",
  "nav.sizeAdvice": "Guía de tallas",
  "cart.title": "Cesta",
  "cart.empty": "Tu cesta está vacía",
  "cart.checkout": "Tramitar pedido",
  "cart.subtotal": "Subtotal",
  "cart.freeShipping": "Tienes derecho a envío gratis",
  "common.addToCart": "Añadir a la cesta",
  "common.chooseSize": "Elige una talla",
  "common.soldOut": "Agotado",
  "common.inStock": "En stock",
  "common.shopNow": "Comprar",
  "common.viewAll": "Ver todo",
  "common.search": "Buscar",
  "common.account": "Mi cuenta",
  "common.wishlist": "Favoritos",
  "footer.shop": "Tienda",
  "footer.service": "Servicio",
  "footer.legal": "Aviso legal",
  "footer.newsletterTitle": "Nuevas colecciones, consejos de estilo y ofertas exclusivas",
  "footer.newsletterCta": "Suscribirse",
  "delivery.beforeCutoff": "Pedido antes de las 16:00, enviado hoy",
  "delivery.free": "Envío gratis a partir de 75 €",
};

const DICTS: Record<Locale, Dict> = { nl, en, de, fr, es };

// NL-bron voor de hele site = handmatig gecureerde dict bovenop de auto-catalogus
// (lib/messages-catalog, uit de i18n-inventarisatie). Handmatige nl wint bij overlap.
const NL_ALL: Dict = { ...SITE_CATALOG, ...nl };

/** Alle bekende NL-bronsleutels (voor de vertaal-cron: dit is de bron-van-waarheid). */
export function uiSourceKeys(): { key: string; source: string }[] {
  return Object.entries(NL_ALL).map(([key, source]) => ({ key, source }));
}

/** Vul {placeholders} in een vertaalde string met params. Onbekende {x} blijft staan. */
export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

export function t(key: string, locale: Locale, params?: Record<string, string | number>): string {
  return interpolate(DICTS[locale]?.[key] ?? NL_ALL[key] ?? key, params);
}

/** Hele woordenboek voor een locale (voor de client-provider). */
export function messagesFor(locale: Locale): Dict {
  return { ...NL_ALL, ...(DICTS[locale] || {}) };
}
