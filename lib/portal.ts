/**
 * De medewerkers-portal. Sinds het beheer van gents.nl daarheen verhuisd is
 * (de Site-studio op /account/* is opgeheven) verwijst de webshop op twee
 * plekken naar de portal: de redirects in next.config.mjs en de ingang op het
 * klantprofiel.
 *
 * NEXT_PUBLIC_ omdat de profielpagina een client component is; de waarde wordt
 * bij de build ingebakken. Geen secret — het is een publieke URL. De override
 * bestaat voor de sandbox- en preview-omgevingen, die hun eigen portal hebben.
 */
export const PORTAL_URL = (process.env.NEXT_PUBLIC_PORTAL_URL || "https://portal.gents.nl").replace(/\/+$/, "");
