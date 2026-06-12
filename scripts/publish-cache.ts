import "@/lib/load-env";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildProductsCachePayload } from "@/lib/products-cache";
import { writeJsonBlobCompat } from "@/lib/blob";

/**
 * Handmatige cache-publicatie (de cron doet dit dagelijks):
 *   npm run cache:publish              # bouwt + schrijft naar de blob-store
 *   npm run cache:publish -- --dry     # alleen bouwen + statistieken tonen
 *   npm run cache:publish -- --out data/cache-preview.json   # ook lokaal bewaren
 */
async function main() {
  const payload = await buildProductsCachePayload();
  console.log(
    `Cache gebouwd: ${payload.productCount} producten, ${payload.variantCount} varianten, ` +
      `${Object.keys(payload.bySku).length} SKU-keys, ${Object.keys(payload.byBarcode).length} barcode-keys.`
  );

  const outIdx = process.argv.indexOf("--out");
  if (outIdx >= 0 && process.argv[outIdx + 1]) {
    mkdirSync("data", { recursive: true });
    writeFileSync(process.argv[outIdx + 1], JSON.stringify(payload, null, 2), "utf8");
    console.log(`Lokale kopie: ${process.argv[outIdx + 1]}`);
  }

  if (process.argv.includes("--dry")) {
    console.log("Dry run — niets geschreven naar de blob-store.");
    return;
  }
  const blob = await writeJsonBlobCompat("shopify-products/cache.json", payload);
  console.log(`Gepubliceerd: ${blob.pathname} (${blob.url})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
