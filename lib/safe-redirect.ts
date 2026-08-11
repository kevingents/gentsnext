/**
 * Doorstuur-veiligheid voor /api/r: een meetbare link mag nooit een open
 * redirect worden. Alleen een pad op onze eigen site is goed genoeg — wie een
 * hele URL meegeeft, wordt geweigerd.
 *
 * Los van de route omdat een Next.js route-bestand alleen handlers mag
 * exporteren; zo is de controle ook zelfstandig testbaar.
 */

/**
 * Geeft het pad terug als het veilig intern is, anders null. Geweigerd:
 * absolute URL's, protocol-relatief ("//host"), backslash-varianten die
 * sommige browsers alsnog als host lezen, schema's (javascript:, data:) en
 * regeleindes (header-injectie).
 */
export function safeInternalPath(raw: string): string | null {
  const to = String(raw || "").trim();
  if (!to || to.length > 512) return null;
  if (!to.startsWith("/")) return null;
  if (to.startsWith("//") || to.startsWith("/\\")) return null;
  if (/[\r\n\t\0]/.test(to)) return null;
  if (/^\/+[a-z][a-z0-9+.-]*:/i.test(to)) return null;
  return to;
}
