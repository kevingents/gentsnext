/**
 * Order-status → NL-label, één bron van waarheid (was op 3 plekken gedupliceerd,
 * met net-verschillende sets). Twee maps, BEWUST apart: de klant leest andere
 * woorden dan de back-office ("In afwachting van betaling" vs "Open").
 * Pure module — geen db/react-imports, bruikbaar in server én client.
 */

/** Back-office (admin-tabellen, filters). */
export const ORDER_STATUS_NL: Record<string, string> = {
  open: "Open",
  paid: "Betaald",
  shipped: "Verzonden",
  ready_pickup: "Klaar om af te halen",
  delivered: "Bezorgd",
  refunded: "Terugbetaald",
  canceled: "Geannuleerd",
  failed: "Mislukt",
  expired: "Verlopen",
  review: "Review",
};

/** Klant ("Mijn GENTS"): vriendelijker labels; incl. de afhaal/bezorg-statussen
 *  die de klant-map voorheen miste (toonden daar de rauwe status). */
export const ORDER_STATUS_NL_KLANT: Record<string, string> = {
  open: "In afwachting van betaling",
  paid: "Betaald",
  shipped: "Verzonden",
  ready_pickup: "Klaar om af te halen",
  delivered: "Bezorgd",
  failed: "Mislukt",
  expired: "Verlopen",
  canceled: "Geannuleerd",
  refunded: "Terugbetaald",
};

/** Retour-status → NL (klant). */
export const RETURN_STATUS_NL: Record<string, string> = {
  requested: "aangemeld",
  label_created: "label klaar",
  received: "ontvangen",
  completed: "afgehandeld",
  cancelled: "geannuleerd",
};
