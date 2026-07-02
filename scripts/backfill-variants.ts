import "@/lib/load-env";
import { getDb } from "@/db";
import { products, productVariants } from "@/db/schema";
import { sql } from "drizzle-orm";
import { colorFamily } from "@/lib/colors";
import { sizeRowLabel } from "@/lib/size-taxonomy";

/**
 * VEILIGE variant-backfill. ~940 producten kregen bij de bootstrap maar één
 * variant mee (de rest van de maatrange ontbreekt), terwijl Shopify + SRS die
 * maten wél op voorraad hebben. Dit script haalt via een Shopify **bulk-operatie**
 * ALLE varianten op en INSERT alleen de ontbrekende (onConflictDoNothing op de
 * bevroren shopify_variant_id) — bestaande varianten, producten, afbeeldingen en
 * collecties blijven volledig ongemoeid. Kleur wordt geërfd van een reeds bestaande
 * variant van hetzelfde product, zodat de maatmatrix één kleurgroep blijft.
 *
 * Draai daarna `npm run sync:catalog` om stock_qty/in_stock uit SRS te vullen.
 *
 *   npx tsx scripts/backfill-variants.ts --dry   # alleen rapporteren
 *   npx tsx scripts/backfill-variants.ts         # écht wegschrijven
 */

const DRY = process.argv.includes("--dry");
const SHOP = (process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_TOKEN || "";
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

const BULK_QUERY = `
{
  products {
    edges { node { id handle
      variants { edges { node { id sku barcode price compareAtPrice
        selectedOptions { name value } image { url } } } }
    } }
  }
}`;

function toCents(price: unknown): number {
  const n = Number.parseFloat(String(price ?? "0").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function detectColorSize(selectedOptions: { name: string; value: string }[]) {
  let color = "", size = "";
  for (const opt of selectedOptions || []) {
    const name = String(opt.name || "").toLowerCase();
    const val = String(opt.value || "").trim();
    if (!val) continue;
    if (name.includes("kleur") || name.includes("color") || name.includes("colour")) color = val;
    else if (name.includes("maat") || name.includes("size")) size = val;
  }
  if (!color || !size) {
    const opts = (selectedOptions || []).map((o) => String(o.value || "").trim());
    if (!color && opts[0] && !/^\d+$/.test(opts[0])) color = opts[0];
    if (!size && opts[1] && /^[\dXSML/]+$/i.test(opts[1])) size = opts[1];
  }
  return { color, size };
}
function gidType(gid: string): string {
  const m = /^gid:\/\/shopify\/([A-Za-z0-9]+)\//.exec(gid || "");
  return m ? m[1] : "";
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function adminGraphql(query: string): Promise<any> {
  const res = await fetch(`https://${SHOP}/admin/api/${VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors).slice(0, 400)}`);
  return json.data;
}

async function runBulk(): Promise<string> {
  const start = await adminGraphql(`mutation { bulkOperationRunQuery(query: """${BULK_QUERY}""") { bulkOperation { id status } userErrors { field message } } }`);
  const errs = start?.bulkOperationRunQuery?.userErrors || [];
  if (errs.length) throw new Error(`bulkOperationRunQuery: ${JSON.stringify(errs)}`);
  console.log(`Bulk-export gestart: ${start.bulkOperationRunQuery.bulkOperation.id}`);
  const started = Date.now();
  for (;;) {
    const data = await adminGraphql(`{ currentBulkOperation { id status errorCode objectCount url } }`);
    const op = data?.currentBulkOperation;
    if (!op) throw new Error("Geen lopende bulk-operatie.");
    if (op.status === "COMPLETED") {
      console.log(`\nBulk-export klaar: ${op.objectCount} objecten.`);
      if (!op.url) throw new Error("Bulk-operatie leverde geen URL (leeg).");
      const r = await fetch(op.url);
      if (!r.ok) throw new Error(`JSONL-download HTTP ${r.status}`);
      return r.text();
    }
    if (op.status === "FAILED" || op.status === "CANCELED") throw new Error(`Bulk ${op.status}: ${op.errorCode || "onbekend"}`);
    if (Date.now() - started > 60 * 60 * 1000) throw new Error("Bulk-operatie timeout (60 min).");
    process.stdout.write(`  export: ${op.status} (${op.objectCount} objecten)\r`);
    await sleep(5000);
  }
}

async function main() {
  if (!SHOP || !TOKEN) throw new Error("SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_ACCESS_TOKEN vereist.");
  const db = getDb();

  // Neon: match-sleutels product (GID én handle), + per product de bestaande kleur,
  // bekende variant-GID's en bekende (product+sku)-combinaties (dedup op maat).
  const prodRows = await db.select({ id: products.id, gid: products.shopifyProductId, handle: products.handle }).from(products);
  const prodByGid = new Map<string, string>();
  const prodByHandle = new Map<string, string>();
  const handleById = new Map<string, string>();
  for (const r of prodRows) {
    if (r.gid) prodByGid.set(r.gid, r.id);
    if (r.handle) prodByHandle.set(r.handle, r.id);
    handleById.set(r.id, r.handle || r.id);
  }

  const vrows = await db.select({ vid: productVariants.shopifyVariantId, pid: productVariants.productId, sku: productVariants.sku, color: productVariants.color }).from(productVariants);
  const existingVid = new Set<string>();
  const existingSkuKey = new Set<string>(); // `${productId}|${lower(sku)}`
  const productColor = new Map<string, string>();
  for (const r of vrows) {
    if (r.vid) existingVid.add(r.vid);
    if (r.sku) existingSkuKey.add(`${r.pid}|${r.sku.trim().toLowerCase()}`);
    if (r.color && !productColor.has(r.pid)) productColor.set(r.pid, r.color);
  }
  console.log(`Neon: ${prodByGid.size} producten met GID, ${existingVid.size} bekende varianten.`);

  const jsonl = await runBulk();

  // Parse: producten (GID→handle) + varianten (met __parentId).
  const gidToHandle = new Map<string, string>();
  const variantsByParent = new Map<string, any[]>();
  let productLines = 0, variantLines = 0;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    const type = gidType(obj.id || "");
    if (type === "Product") { productLines++; if (obj.handle) gidToHandle.set(obj.id, String(obj.handle)); }
    else if (type === "ProductVariant" && obj.__parentId) {
      variantLines++;
      if (!variantsByParent.has(obj.__parentId)) variantsByParent.set(obj.__parentId, []);
      variantsByParent.get(obj.__parentId)!.push(obj);
    }
  }
  console.log(`Shopify: ${productLines} producten, ${variantLines} varianten.`);

  // Alleen ONTBREKENDE varianten van BESTAANDE producten (match op GID óf handle,
  // dedup op product+sku zodat een reeds bekende maat nooit dubbel komt).
  type Row = typeof productVariants.$inferInsert;
  const rows: Row[] = [];
  let seen = 0, existing = 0, noProduct = 0;
  for (const [gid, vlist] of variantsByParent) {
    const productId = prodByGid.get(gid) || prodByHandle.get(gidToHandle.get(gid) || "");
    if (!productId) { noProduct += vlist.length; continue; }
    vlist.forEach((v, i) => {
      seen++;
      const sku = String(v.sku || "").trim();
      if (existingVid.has(v.id) || (sku && existingSkuKey.has(`${productId}|${sku.toLowerCase()}`))) { existing++; return; }
      const det = detectColorSize(v.selectedOptions || []);
      const color = det.color || productColor.get(productId) || "";
      rows.push({
        productId,
        sku,
        barcode: String(v.barcode || "").trim(),
        position: Number(v.position) || i,
        size: det.size,
        sizeLabel: det.size ? sizeRowLabel(det.size) : "",
        color,
        colorFamily: color ? colorFamily(color) : "",
        priceCents: toCents(v.price),
        compareAtCents: v.compareAtPrice ? toCents(v.compareAtPrice) : null,
        shopifyVariantId: v.id,
        imageUrl: v.image?.url || "",
      });
    });
  }
  const byProduct = new Map<string, number>();
  for (const r of rows) byProduct.set(r.productId!, (byProduct.get(r.productId!) || 0) + 1);
  console.log(`\nAnalyse: ${seen} varianten gezien · ${existing} bestaan al · ${noProduct} bij niet-in-Neon-producten · ${rows.length} NIEUW toe te voegen.`);
  console.log(`→ ${rows.length} nieuwe varianten over ${byProduct.size} producten. Top-getroffen:`);
  [...byProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
    .forEach(([pid, n]) => console.log(`    +${String(n).padStart(3)}  ${handleById.get(pid) || pid}`));

  if (DRY) { console.log("DRY-RUN — niets weggeschreven. Draai zonder --dry om het door te voeren."); process.exit(0); }
  if (!rows.length) { console.log("Niets toe te voegen."); process.exit(0); }

  const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  let written = 0;
  for (const part of chunk(rows, 200)) {
    await db.insert(productVariants).values(part).onConflictDoNothing({ target: productVariants.shopifyVariantId });
    written += part.length;
    process.stdout.write(`\r  weggeschreven ${written}/${rows.length}`);
  }
  console.log(`\n✓ ${written} varianten toegevoegd. Draai nu: npm run sync:catalog (vult stock_qty/in_stock uit SRS).`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
