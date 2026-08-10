/**
 * instrumentation.ts — draait één keer per serverproces, vóór alle routes.
 *
 * Hier wordt het sandbox-netwerkslot geïnstalleerd. Next roept `register()` aan
 * bij het opstarten van elke runtime-instantie, dus vóór de eerste request; er
 * is geen pad waarlangs een route-handler eerder zou kunnen draaien. Dat is
 * precies wat een netwerkslot nodig heeft — het moet er zijn vóór de eerste
 * `fetch`, niet erna.
 *
 * Buiten de sandbox (GENTS_SANDBOX != 1) doet de import niets: geen patch, geen
 * kosten. Productie merkt hier dus niets van.
 *
 * Alleen de Node-runtime: de nep-diensten bewaren hun stand in Vercel Blob en
 * dat pakket draait niet op de edge. De middleware (edge) doet ook geen
 * uitgaande koppelingen, dus daar valt niets te beschermen.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/sandbox/index.js");
  }
}
