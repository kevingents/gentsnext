/**
 * Statusmelding van een Mollie-pinbetaling terug naar de kassa (storegents).
 *
 * Mollie stuurt z'n webhook hierheen — de terminalsleutel zit in dit project.
 * Het pin-log dat de dagafsluiting leest, staat in storegents. Deze functie is
 * de brug: uitkomst ophalen bij Mollie (daar), hier melden.
 *
 * Server-to-server met het gedeelde STORE_CORE_TOKEN (Bearer) — hetzelfde
 * patroon als de webshop-ticketintake in lib/helpdesk.ts, en het spiegelbeeld
 * van hoe de kassa deze core aanroept.
 *
 * Zet in Vercel:
 *   STOREGENTS_API_URL  (default https://storegents.vercel.app)
 *   STORE_CORE_TOKEN    (zelfde waarde als in storegents)
 */

const BASE = (process.env.STOREGENTS_API_URL || "https://storegents.vercel.app").replace(/\/$/, "");

export type PinMelding = {
  paymentId: string;
  status: string;
  amountCents?: number;
  store?: string;
  clientRef?: string;
  description?: string;
};

/**
 * Meld de uitkomst. `false` = niet aangekomen; de aanroeper moet dan een
 * niet-200 teruggeven aan Mollie, zodat Mollie de webhook opnieuw stuurt. Dit
 * stil laten mislukken zou het gat terugbrengen dat we juist dichten.
 */
export async function meldPinStatusAanKassa(melding: PinMelding): Promise<boolean> {
  const token = (process.env.STORE_CORE_TOKEN || "").trim();
  if (!token) {
    console.error("[pin-terminal-melding] STORE_CORE_TOKEN ontbreekt — status niet gemeld.");
    return false;
  }
  if (!melding?.paymentId || !melding?.status) return false;
  try {
    const res = await fetch(`${BASE}/api/pin-terminal-melding`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(melding),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[pin-terminal-melding] ${melding.paymentId}: storegents ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[pin-terminal-melding] ${melding.paymentId}:`, (e as Error).message);
    return false;
  }
}
