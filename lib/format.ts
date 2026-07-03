/**
 * Pure formatteer-helpers — bewust ZONDER db/drizzle-imports zodat client
 * components alleen dit kleine bestand bundelen (lib/pricing re-exportte
 * formatEuro maar sleept getDb mee). Eén bron van waarheid voor NL-bedragen;
 * de hand-rolled `toFixed(2)`-varianten toonden punt-decimalen ("€ 10.00")
 * in Nederlandse teksten.
 *
 * NIET voor machine-formaten: Mollie-amounts ("10.00"), JSON-LD-prijzen en
 * core-API-payloads vereisen punt-decimaal en blijven bewust lokaal.
 */

export function formatEuro(cents: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(
    cents / 100
  );
}

/** CSV-variant (Excel, puntkomma-CSV): komma-decimaal, zónder €-teken. */
export function formatEuroCsv(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
