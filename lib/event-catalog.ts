/**
 * De event-catalogus: één bron van waarheid voor álles wat we meten.
 *
 * Hier stond eerder een kale `Set` met veertien namen, verstopt in
 * lib/analytics. Dat gaf drie terugkerende problemen:
 *
 *  - Events die wél gevuurd werden maar niet in de set stonden verdwenen STIL.
 *    Zo is `search_click` een tijd lang volledig weggegooid; de enige
 *    doorklikmeting die er was.
 *  - Niemand kon zien wélke events er bestonden zonder de codebase af te
 *    grepen, dus rapportages verwezen naar namen die nooit gevuurd werden
 *    (de footer- en tegel-buckets in nav-insights stonden structureel leeg).
 *  - Er was geen enkele relatie met de namen die Google Analytics, Google Ads
 *    en Meta verwachten, waardoor elke tag met de hand vertaald moest worden.
 *
 * Deze catalogus is nu de enige plek waar een event geboren wordt. Hij bepaalt
 * wat de server accepteert, onder welke naam het naar de dataLayer gaat, of het
 * marketing-toestemming nodig heeft, en wat het betekent. Een event toevoegen =
 * hier één regel toevoegen.
 *
 * TOESTEMMING (belangrijk): `marketing: true` betekent dat een event alleen naar
 * de dataLayer mag als de bezoeker marketing-cookies heeft geaccepteerd, omdat
 * het bedoeld is voor advertentieplatforms. Naar onze eigen Neon-tabel gaat het
 * al bij analytics-toestemming — dat is de eerste partij en een ander doel.
 */

export type EventGroep =
  | "pagina"
  | "catalogus"
  | "wagen"
  | "checkout"
  | "account"
  | "service"
  | "loyalty"
  | "experiment";

export type EventDef = {
  /** Interne naam — dit is wat in Neon staat. Nooit hernoemen zonder migratie. */
  naam: string;
  /** Naam in de dataLayer/GA4. Leeg = blijft first-party, gaat niet naar GTM. */
  ga4?: string;
  /** Vult een GA4-`ecommerce`-object in de dataLayer (items, value, currency). */
  ecommerce?: boolean;
  /** Alleen naar de dataLayer met marketing-toestemming. */
  marketing?: boolean;
  groep: EventGroep;
  uitleg: string;
};

/* eslint-disable prettier/prettier */
export const EVENT_CATALOG: EventDef[] = [
  /* ───────────────────────────── Pagina & navigatie ──────────────────────── */
  { naam: "pageview",        ga4: "page_view",       groep: "pagina",    uitleg: "Elke paginaweergave (ook bij client-side navigatie)." },
  { naam: "nav_click",       ga4: "nav_click",       groep: "pagina",    uitleg: "Klik in menu, header, footer of homepage-tegel — props.source zegt welke." },
  { naam: "scroll_diep",     ga4: "scroll",          groep: "pagina",    uitleg: "Scrolldiepte 25/50/75/90% — meet of een lange pagina echt gelezen wordt." },
  { naam: "uitgaande_klik",  ga4: "click",           groep: "pagina",    uitleg: "Klik naar een externe site (social, Google Maps, betaalpartner)." },
  { naam: "bestand_download",ga4: "file_download",   groep: "pagina",    uitleg: "Download van een maattabel, factuur of retourformulier." },
  { naam: "pagina_fout",     ga4: "page_not_found",  groep: "pagina",    uitleg: "404 met de gevraagde URL — voedt de redirect-lijst." },
  { naam: "delen",           ga4: "share",           groep: "pagina",    uitleg: "Product of look gedeeld." },
  { naam: "banner_getoond",  ga4: "view_promotion",  ecommerce: true,    groep: "pagina", uitleg: "Aanbieding/aankondiging in beeld gekomen." },
  { naam: "banner_klik",     ga4: "select_promotion",ecommerce: true,    groep: "pagina", uitleg: "Klik op een aanbieding of aankondigingsbalk." },

  /* ──────────────────────────────── Catalogus ────────────────────────────── */
  { naam: "lijst_bekeken",   ga4: "view_item_list",  ecommerce: true,    groep: "catalogus", uitleg: "Een productlijst (categorie, zoekresultaat, look) in beeld." },
  { naam: "product_click",   ga4: "select_item",     ecommerce: true,    groep: "catalogus", uitleg: "Klik op een product in een lijst — mét positie, tegen positie-bias." },
  { naam: "product_view",    ga4: "view_item",       ecommerce: true,    groep: "catalogus", uitleg: "Productpagina bekeken." },
  { naam: "filter",                                  groep: "catalogus", uitleg: "Filter aan- of uitgezet (facet + waarde)." },
  { naam: "sort",                                    groep: "catalogus", uitleg: "Sortering gewijzigd." },
  { naam: "meer_laden",                              groep: "catalogus", uitleg: "Volgende pagina van een lijst geladen." },
  { naam: "size_click",                              groep: "catalogus", uitleg: "Klik op een UITVERKOCHTE maat — direct inkoopsignaal." },
  { naam: "maat_gekozen",                            groep: "catalogus", uitleg: "Maat geselecteerd op de PDP." },
  { naam: "kleur_gewisseld",                         groep: "catalogus", uitleg: "Naar een andere kleurvariant gesprongen." },
  { naam: "media_bekeken",                           groep: "catalogus", uitleg: "Extra productfoto of zoom geopend." },
  { naam: "maattabel_open",                          groep: "catalogus", uitleg: "Maattabel geopend — twijfel over de maat." },
  { naam: "maatadvies_start",                        groep: "catalogus", uitleg: "Maatadvies/size-finder gestart." },
  { naam: "maatadvies_klaar",                        groep: "catalogus", uitleg: "Maatadvies afgerond, mét de geadviseerde maat." },
  { naam: "winkelvoorraad_bekeken",                  groep: "catalogus", uitleg: "Voorraad per winkel opgevraagd (click&collect)." },
  { naam: "levertijd_bekeken",                       groep: "catalogus", uitleg: "Levertijd-uitleg geopend." },
  { naam: "look_bekeken",    ga4: "view_item_list",  ecommerce: true,    groep: "catalogus", uitleg: "Look/outfit-pagina bekeken." },
  { naam: "mixmatch_bekeken",                        groep: "catalogus", uitleg: "Combinatie-suggestie (pak + overhemd) getoond." },

  /* ──────────────────────────── Wagen & verlanglijst ─────────────────────── */
  { naam: "add_to_cart",     ga4: "add_to_cart",     ecommerce: true, marketing: true, groep: "wagen", uitleg: "Product in de winkelwagen." },
  { naam: "remove_from_cart",ga4: "remove_from_cart",ecommerce: true,    groep: "wagen", uitleg: "Product uit de winkelwagen." },
  { naam: "cart_view",       ga4: "view_cart",       ecommerce: true,    groep: "wagen", uitleg: "Winkelwagen (lade of pagina) geopend." },
  { naam: "aantal_gewijzigd",                        groep: "wagen",     uitleg: "Aantal in de wagen aangepast." },
  { naam: "wishlist_add",    ga4: "add_to_wishlist", ecommerce: true, marketing: true, groep: "wagen", uitleg: "Op de verlanglijst gezet." },
  { naam: "wishlist_remove",                         groep: "wagen",     uitleg: "Van de verlanglijst gehaald." },

  /* ──────────────────────────────── Checkout ─────────────────────────────── */
  { naam: "checkout_start",  ga4: "begin_checkout",  ecommerce: true, marketing: true, groep: "checkout", uitleg: "Checkout gestart." },
  { naam: "checkout_stap",                           groep: "checkout",  uitleg: "Stap binnen de checkout bereikt (gegevens, verzending, betalen)." },
  { naam: "verzendkeuze",    ga4: "add_shipping_info",ecommerce: true,   groep: "checkout", uitleg: "Verzendmethode gekozen (standaard, express, afhalen)." },
  { naam: "betaalkeuze",     ga4: "add_payment_info",ecommerce: true,    groep: "checkout", uitleg: "Betaalmethode gekozen." },
  { naam: "afhalen_gekozen",                         groep: "checkout",  uitleg: "Afhalen in winkel gekozen, mét de winkel." },
  { naam: "voucher_toegepast",                       groep: "checkout",  uitleg: "Kortingscode geaccepteerd." },
  { naam: "voucher_geweigerd",                       groep: "checkout",  uitleg: "Kortingscode afgewezen — mét de reden; hier lekt omzet weg." },
  { naam: "checkout_fout",                           groep: "checkout",  uitleg: "Validatie- of betaalfout in de checkout." },
  { naam: "purchase",        ga4: "purchase",        ecommerce: true, marketing: true, groep: "checkout", uitleg: "Betaalde bestelling. Bron van waarheid is de server, niet de bedanktpagina." },
  { naam: "refund",          ga4: "refund",          ecommerce: true,    groep: "checkout", uitleg: "Terugbetaling na retour — corrigeert de omzet bij de advertentieplatforms." },

  /* ───────────────────────────────── Account ─────────────────────────────── */
  { naam: "login",           ga4: "login",           groep: "account",   uitleg: "Ingelogd (magic link of wachtwoord)." },
  { naam: "sign_up",         ga4: "sign_up",         marketing: true,    groep: "account", uitleg: "Nieuw account aangemaakt." },
  { naam: "magic_link",                              groep: "account",   uitleg: "Inloglink aangevraagd." },
  { naam: "profiel_afgerond",                        groep: "account",   uitleg: "Profiel compleet gemaakt (maten/voorkeuren)." },
  { naam: "maatprofiel_opgeslagen",                  groep: "account",   uitleg: "Maatprofiel bewaard — de basis onder persoonlijk advies." },

  /* ──────────────────────────── Service & binding ────────────────────────── */
  { naam: "search",          ga4: "search",          groep: "service",   uitleg: "Zoekopdracht." },
  { naam: "search_no_results",                       groep: "service",   uitleg: "Zoekopdracht zonder resultaat — gemiste vraag." },
  { naam: "search_click",                            groep: "service",   uitleg: "Doorklik op een zoekresultaat." },
  { naam: "stock_notify",    ga4: "generate_lead",   marketing: true,    groep: "service", uitleg: "Terug-op-voorraad-melding aangevraagd." },
  { naam: "afspraak_start",                          groep: "service",   uitleg: "Afspraakformulier geopend." },
  { naam: "afspraak_geboekt",ga4: "generate_lead",   marketing: true,    groep: "service", uitleg: "Afspraak geboekt (type + winkel). Server-side bevestigd." },
  { naam: "retour_gestart",                          groep: "service",   uitleg: "Retourportaal geopend." },
  { naam: "retour_aangemeld",                        groep: "service",   uitleg: "Retour daadwerkelijk aangemeld." },
  { naam: "ticket_gesteld",                          groep: "service",   uitleg: "Klantvraag gesteld via de site." },
  { naam: "nieuwsbrief",     ga4: "generate_lead",   marketing: true,    groep: "service", uitleg: "Nieuwsbriefinschrijving bevestigd." },
  { naam: "whatsapp_optin",  ga4: "generate_lead",   marketing: true,    groep: "service", uitleg: "WhatsApp-opt-in." },
  { naam: "hulp_geopend",                            groep: "service",   uitleg: "Hulpknop of chat geopend." },

  /* ───────────────────────────────── Loyalty ─────────────────────────────── */
  { naam: "punten_ingewisseld",                      groep: "loyalty",   uitleg: "Spaarpunten omgezet in tegoed." },
  { naam: "giftcard_gekocht",                        groep: "loyalty",   uitleg: "Cadeaubon gekocht." },
  { naam: "giftcard_ingewisseld",                    groep: "loyalty",   uitleg: "Cadeaubon gebruikt als betaalmiddel." },
  { naam: "wallet_toegevoegd",                       groep: "loyalty",   uitleg: "Loyaliteitspas aan Apple Wallet toegevoegd." },
  { naam: "bon_geclaimd",                            groep: "loyalty",   uitleg: "Kassabon aan het account gekoppeld via QR." },

  /* ────────────────────── Experimenten & herstelacties ───────────────────── */
  // Bestond al vóór deze catalogus; hier opgenomen zodat de allowlist compleet
  // blijft. Zonder deze regels zouden de A/B-metingen en de alternatieven-flow
  // per direct stil ophouden met loggen.
  { naam: "ab_exposure",                             groep: "experiment", uitleg: "Eén exposure per sessie per experiment, handle = '<experiment>:<variant>'. Conversie wordt niet apart geteld — dat zijn de purchase-events van dezelfde sessie." },
  // Puntenbonussen (maatprofiel/Wallet/winkel/profiel), handle = de soort.
  // Alleen de KANS en de KLIK: het toekennen staat al in het spaarpunten-
  // grootboek, en dat overtypen naar events zou een tweede telling maken die
  // ermee kan gaan verschillen. Zonder bonus_shown weet je alleen hoeveel mensen
  // een bonus haalden, niet hoeveel er de kans op kregen.
  { naam: "bonus_shown",                             groep: "loyalty",    uitleg: "Puntenbonus getoond (de kans), handle = de soort bonus." },
  { naam: "bonus_click",                             groep: "loyalty",    uitleg: "Klik op een getoonde puntenbonus." },
  { naam: "alt_offered",                             groep: "service",    uitleg: "Alternatieven getoond bij een annulering (bij het versturen van de mail)." },
  { naam: "alt_click",                               groep: "service",    uitleg: "Doorklik op zo'n alternatief — haalt een annulering nog iets op?" },
];
/* eslint-enable prettier/prettier */

/**
 * Gedeclareerd maar (nog) NERGENS gevuurd.
 *
 * Deze lijst staat er expres. De vorige allowlist ging juist mis omdat niemand
 * kon zien welke events echt bestonden: de rapportage verwees naar
 * footer- en tegel-klikken die nooit gemeten werden, en die blokken stonden
 * jarenlang leeg zonder dat iemand doorhad dat de MEETKANT ontbrak — het leek
 * gewoon of er niet op geklikt werd.
 *
 * Een event hierin is dus geen bug maar een openstaande aansluiting. Zolang hij
 * hier staat mag geen enkel dashboard of doelgroepregel doen alsof er data is.
 * Sluit je 'm aan, haal 'm dan hier weg — dat is de hele ceremonie.
 */
export const NOG_NIET_AANGESLOTEN: ReadonlySet<string> = new Set([
  // Pagina
  "uitgaande_klik", "bestand_download", "pagina_fout", "delen",
  "banner_getoond", "banner_klik",
  // Catalogus — de PDP-interacties. Waardevol (maat-frictie, twijfel over de
  // pasvorm), maar elk een aparte plek in de PDP-componenten.
  "meer_laden", "maat_gekozen", "kleur_gewisseld", "media_bekeken",
  "maattabel_open", "maatadvies_start", "maatadvies_klaar",
  "winkelvoorraad_bekeken", "levertijd_bekeken",
  // Checkout
  "afhalen_gekozen",
  // refund hoort server-side aan de retour-afhandeling te hangen, zodat de
  // omzet bij Google en Meta gecorrigeerd wordt na een retour.
  "refund",
  // Account
  "login", "sign_up", "magic_link", "profiel_afgerond", "maatprofiel_opgeslagen",
  // Service
  "afspraak_start", "retour_gestart", "retour_aangemeld", "ticket_gesteld",
  "whatsapp_optin", "hulp_geopend",
  // Loyalty
  "punten_ingewisseld", "giftcard_gekocht", "wallet_toegevoegd", "bon_geclaimd",
]);

const BY_NAAM = new Map(EVENT_CATALOG.map((e) => [e.naam, e]));

/** Wat de server accepteert. Alles daarbuiten wordt geweigerd, niet stil geslikt. */
export const TOEGESTANE_EVENTS: ReadonlySet<string> = new Set(EVENT_CATALOG.map((e) => e.naam));

export function eventDef(naam: string): EventDef | undefined {
  return BY_NAAM.get(naam);
}

/** Events per groep — voor het meetplan-overzicht in de portal. */
export function catalogusPerGroep(): Record<EventGroep, EventDef[]> {
  const out = {} as Record<EventGroep, EventDef[]>;
  for (const e of EVENT_CATALOG) (out[e.groep] ||= []).push(e);
  return out;
}
