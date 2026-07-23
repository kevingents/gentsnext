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
  // PLP: sorteer-opties + Sale-badge (bron voor de vertaal-cron; waren hardcoded).
  "plp.sort.aanbevolen": "Aanbevolen",
  "plp.sort.populair": "Populair",
  "plp.sort.nieuw": "Nieuwste",
  "plp.sort.prijs-op": "Prijs oplopend",
  "plp.sort.prijs-af": "Prijs aflopend",
  "plp.sort.naam": "Naam (A–Z)",
  "plp.badge.sale": "Sale",
  // Reserveer-om-te-passen (PDP Click&Collect-modal)
  "reserve.intro": "Gratis en vrijblijvend: reserveer om te passen — we leggen 'm voor je klaar in de winkel.",
  "reserve.cta": "Leg voor mij klaar",
  "reserve.formIntro": "Reserveren om te passen bij {store} — we houden 'm voor je vast en je hoeft niets te betalen.",
  "reserve.name": "Naam",
  "reserve.email": "E-mailadres",
  "reserve.phone": "Telefoon (optioneel)",
  "reserve.submit": "Reserveer om te passen",
  "reserve.success.title": "Gereserveerd!",
  "reserve.success.body": "We leggen 'm voor je klaar bij {store}. Je ontvangt een bevestiging per e-mail.",
  "reserve.success.until": "We houden 'm vast t/m {date}.",
  "reserve.error.name": "Vul je naam in.",
  "reserve.error.email": "Vul een geldig e-mailadres in.",
  "reserve.error.generic": "Reserveren lukte net niet — probeer het opnieuw of bel de winkel.",
  "clickCollect.modal.left": "Nog {count}",
  "clickCollect.modal.addresses": "Adressen & openingstijden",
  "pdp.aiImageNote": "Beeld ter indicatie (AI-weergave) — details kunnen afwijken van het echte artikel.",
  // Reviews-sectie (was hardcoded NL → lekte door op /en)
  "reviews.section.title": "Wat klanten zeggen",
  "reviews.section.emptyIntro": "Er zijn nog geen reviews voor dit artikel. Deel als eerste je ervaring.",
  "reviews.section.emptyList": "Nog geen geschreven reviews — schrijf de eerste.",
  "reviews.section.countSingular": "review",
  "reviews.section.countPlural": "reviews",
  "checkout.pickup_none_full": "Geen enkele winkel heeft op dit moment je hele bestelling op voorraad. Kies bezorgen — dan sturen we alles in één keer thuis.",
  "checkout.pickup_check_failed": "De winkelvoorraad kon niet worden gecontroleerd.",
  "checkout.pickup_retry": "Probeer opnieuw",
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
  // Topbar: zonder deze keys viel de EN-balk half terug op NL (mixed-language).
  "announcement.personalAdvice": "Personal advice in our 19 stores",
  "common.findStore": "find a store",
  "plp.sort.aanbevolen": "Recommended",
  "plp.sort.populair": "Popular",
  "plp.sort.nieuw": "Newest",
  "plp.sort.prijs-op": "Price: low to high",
  "plp.sort.prijs-af": "Price: high to low",
  "plp.sort.naam": "Name (A–Z)",
  "plp.badge.sale": "Sale",
  "reserve.intro": "Free and without obligation: reserve to try on — we'll set it aside for you in store.",
  "reserve.cta": "Set aside for me",
  "reserve.formIntro": "Reserve to try on at {store} — we'll hold it for you, nothing to pay now.",
  "reserve.name": "Name",
  "reserve.email": "Email address",
  "reserve.phone": "Phone (optional)",
  "reserve.submit": "Reserve to try on",
  "reserve.success.title": "Reserved!",
  "reserve.success.body": "We'll set it aside for you at {store}. You'll receive a confirmation by email.",
  "reserve.success.until": "We'll hold it until {date}.",
  "reserve.error.name": "Please enter your name.",
  "reserve.error.email": "Please enter a valid email address.",
  "reserve.error.generic": "The reservation didn't go through — please try again or call the store.",
  "clickCollect.modal.left": "{count} left",
  "clickCollect.modal.addresses": "Addresses & opening hours",
  "pdp.aiImageNote": "Image for illustration (AI rendering) — details may differ from the actual item.",
  "reviews.section.title": "What customers say",
  "reviews.section.emptyIntro": "There are no reviews for this item yet. Be the first to share your experience.",
  "reviews.section.emptyList": "No written reviews yet — write the first one.",
  "reviews.section.countSingular": "review",
  "reviews.section.countPlural": "reviews",
  "checkout.pickup_none_full": "No store currently has your entire order in stock. Choose delivery instead — we'll ship everything to you in one go.",
  "checkout.pickup_check_failed": "We couldn't check store stock.",
  "checkout.pickup_retry": "Try again",
};

const de: Dict = {
  "pdp.aiImageNote": "Abbildung zur Orientierung (KI-Darstellung) — Details können vom tatsächlichen Artikel abweichen.",
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
  "pdp.aiImageNote": "Image à titre indicatif (rendu IA) — les détails peuvent différer de l'article réel.",
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
  "pdp.aiImageNote": "Imagen orientativa (representación por IA) — los detalles pueden diferir del artículo real.",
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
