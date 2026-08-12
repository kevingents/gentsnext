import "@/lib/load-env";
import { syncCatalogFlags } from "@/lib/catalog-flags";
import { processStockNotifications } from "@/lib/stock-notify";

/**
 * Handmatige draai van de catalogus-vlaggen (has_image, in_stock, stock_qty,
 * kleurgroepen). De logica zelf staat in lib/catalog-flags, zodat dezelfde pass
 * ook elke 4 uur vanaf /api/cron/sync-catalog loopt.
 *
 *   npm run sync:catalog            → vlaggen bijwerken
 *   npm run sync:catalog -- --mail  → én de terug-op-voorraad-mails versturen
 *
 * De mails zitten achter een vlag: ze gaan naar echte klanten, en de cron
 * /api/cron/stock-check verstuurt ze al elke 4 uur. Zonder die rem stuurde een
 * handmatige sync ze er nog een keer overheen.
 */
async function main() {
  console.log("⏳ catalogus-vlaggen bijwerken…");
  const t0 = Date.now();
  const s = await syncCatalogFlags();
  console.log(
    `✓ Klaar in ${Math.round((Date.now() - t0) / 1000)}s. ${s.producten} actieve producten, ${s.varianten} varianten, ` +
      `${s.kleurgroepen} kleurgroepen, ${s.opVoorraad} op voorraad.\n` +
      `  Zichtbaar in de catalogus (foto + voorraad + primair): ${s.zichtbaar}.`,
  );

  if (process.argv.includes("--mail")) {
    const notified = await processStockNotifications();
    console.log(`✓ ${notified} terug-op-voorraad-notificatie(s) verstuurd.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
