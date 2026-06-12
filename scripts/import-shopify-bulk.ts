import "@/lib/load-env";
import { mkdirSync, writeFileSync } from "node:fs";
import { upsertCatalog, type ImportProduct, type ImportVariant } from "@/lib/catalog-import";

/**
 * Volledige catalogus-migratie via Shopify Admin GraphQL Bulk Operations.
 * Dit is de gezaghebbende export (de dagelijkse cache is een lossy index):
 * producten + varianten + ALLE metafields + media + collecties + SEO-velden.
 *
 * Vereist env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN
 * Optioneel: SHOPIFY_API_VERSION (default 2025-01), SHOPIFY_SRS_METAFIELD_NS
 *
 * Gebruik:
 *   npm run import:shopify              # export + import
 *   npm run import:shopify -- --save    # bewaart de ruwe JSONL in ./data/
 */

const SHOP = (process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_TOKEN || "";
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const SRS_NS = (process.env.SHOPIFY_SRS_METAFIELD_NS || "SRSERP").toLowerCase();

const BULK_QUERY = `
{
  products {
    edges {
      node {
        id
        handle
        title
        descriptionHtml
        vendor
        productType
        status
        createdAt
        publishedAt
        seo { title description }
        metafields {
          edges { node { id namespace key value } }
        }
        media {
          edges { node { id ... on MediaImage { image { url altText } } } }
        }
        collections {
          edges { node { id handle title } }
        }
        variants {
          edges {
            node {
              id
              sku
              barcode
              price
              compareAtPrice
              position
              selectedOptions { name value }
              image { url }
              metafields {
                edges { node { id namespace key value } }
              }
            }
          }
        }
      }
    }
  }
}`;

async function adminGraphql(query: string): Promise<any> {
  if (!SHOP || !TOKEN) {
    throw new Error("SHOPIFY_STORE_DOMAIN en SHOPIFY_ADMIN_ACCESS_TOKEN zijn vereist.");
  }
  const res = await fetch(`https://${SHOP}/admin/api/${VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Shopify GraphQL HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors).slice(0, 500)}`);
  return json.data;
}

async function startBulkOperation(): Promise<void> {
  const mutation = `
    mutation {
      bulkOperationRunQuery(query: """${BULK_QUERY}""") {
        bulkOperation { id status }
        userErrors { field message }
      }
    }`;
  const data = await adminGraphql(mutation);
  const errors = data?.bulkOperationRunQuery?.userErrors || [];
  if (errors.length) throw new Error(`bulkOperationRunQuery: ${JSON.stringify(errors)}`);
  console.log(`Bulk-operatie gestart: ${data.bulkOperationRunQuery.bulkOperation.id}`);
}

async function waitForBulkOperation(): Promise<string> {
  const started = Date.now();
  const MAX_MS = 60 * 60 * 1000;
  for (;;) {
    const data = await adminGraphql(
      `{ currentBulkOperation { id status errorCode objectCount url } }`
    );
    const op = data?.currentBulkOperation;
    if (!op) throw new Error("Geen lopende bulk-operatie gevonden.");
    if (op.status === "COMPLETED") {
      console.log(`Bulk-export klaar: ${op.objectCount} objecten.`);
      if (!op.url) throw new Error("Bulk-operatie leverde geen download-URL (lege dataset?).");
      return op.url;
    }
    if (op.status === "FAILED" || op.status === "CANCELED") {
      throw new Error(`Bulk-operatie ${op.status}: ${op.errorCode || "onbekend"}`);
    }
    if (Date.now() - started > MAX_MS) throw new Error("Bulk-operatie timeout (60 min).");
    process.stdout.write(`  status: ${op.status} (${op.objectCount} objecten)\r`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

type Metafield = { namespace: string; key: string; value: string };

/** Zelfde prioriteit als storegents: SRSERP-namespace wint, rest vult aan. */
function metafieldMap(fields: Metafield[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of fields) {
    if (f.namespace.toLowerCase() !== SRS_NS) continue;
    const k = f.key.trim();
    const v = String(f.value ?? "").trim();
    if (k && v) map[k] = v;
  }
  for (const f of fields) {
    if (f.namespace.toLowerCase() === SRS_NS) continue;
    const k = f.key.trim();
    const v = String(f.value ?? "").trim();
    if (k && v && !map[k]) map[k] = v;
  }
  return map;
}

function detectColorSize(selectedOptions: { name: string; value: string }[]) {
  let color = "";
  let size = "";
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

function toCents(price: unknown): number {
  const parsed = Number.parseFloat(String(price ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function gidType(gid: string): string {
  const match = /^gid:\/\/shopify\/([A-Za-z0-9]+)\//.exec(gid || "");
  return match ? match[1] : "";
}

async function main() {
  await startBulkOperation();
  const url = await waitForBulkOperation();

  console.log("JSONL downloaden…");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JSONL-download mislukte: HTTP ${res.status}`);
  const text = await res.text();

  if (process.argv.includes("--save")) {
    mkdirSync("data", { recursive: true });
    const file = `data/shopify-bulk-${new Date().toISOString().slice(0, 10)}.jsonl`;
    writeFileSync(file, text, "utf8");
    console.log(`Ruwe export bewaard: ${file}`);
  }

  /* ── JSONL parsen: regels routeren op GID-type + __parentId ──────────── */
  type RawProduct = {
    node: any;
    metafields: Metafield[];
    images: { url: string; alt: string }[];
    collections: { id: string; handle: string; title: string }[];
    variants: { node: any; metafields: Metafield[] }[];
  };
  const productsById = new Map<string, RawProduct>();
  const variantsById = new Map<string, { product: RawProduct; entry: { node: any; metafields: Metafield[] } }>();

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    const type = gidType(obj.id || "");
    const parentId: string | undefined = obj.__parentId;

    if (type === "Product") {
      productsById.set(obj.id, { node: obj, metafields: [], images: [], collections: [], variants: [] });
      continue;
    }
    if (!parentId) continue;

    if (type === "ProductVariant") {
      const product = productsById.get(parentId);
      if (!product) continue;
      const entry = { node: obj, metafields: [] as Metafield[] };
      product.variants.push(entry);
      variantsById.set(obj.id, { product, entry });
    } else if (type === "Metafield") {
      const asVariant = variantsById.get(parentId);
      if (asVariant) asVariant.entry.metafields.push(obj);
      else productsById.get(parentId)?.metafields.push(obj);
    } else if (type === "MediaImage") {
      const product = productsById.get(parentId);
      if (product && obj.image?.url) {
        product.images.push({ url: obj.image.url, alt: obj.image.altText || "" });
      }
    } else if (type === "Collection") {
      productsById.get(parentId)?.collections.push({ id: obj.id, handle: obj.handle, title: obj.title });
    }
  }

  /* ── Naar ImportProduct ──────────────────────────────────────────────── */
  const items: ImportProduct[] = [];
  for (const raw of productsById.values()) {
    const node = raw.node;
    const attrs = metafieldMap(raw.metafields);
    const variants: ImportVariant[] = raw.variants.map((v, i) => {
      const variantAttrs = metafieldMap(v.metafields);
      const { color, size } = detectColorSize(v.node.selectedOptions || []);
      return {
        shopifyVariantId: v.node.id,
        sku: String(v.node.sku || "").trim(),
        barcode: String(v.node.barcode || "").trim(),
        priceCents: toCents(v.node.price),
        compareAtCents: v.node.compareAtPrice ? toCents(v.node.compareAtPrice) : null,
        color,
        size,
        position: Number(v.node.position) || i,
        imageUrl: v.node.image?.url || "",
        srsArtikelId: variantAttrs["artikel_id"] || attrs["artikel_id"] || "",
        srsRveArtikelnummer: variantAttrs["rve_artikelnummer"] || attrs["rve_artikelnummer"] || "",
        attributes: variantAttrs,
      };
    });

    items.push({
      shopifyProductId: node.id,
      handle: String(node.handle || "").trim(),
      title: String(node.title || "").trim(),
      descriptionHtml: String(node.descriptionHtml || ""),
      vendor: String(node.vendor || "").trim(),
      productType: String(node.productType || "").trim(),
      status: String(node.status || "ACTIVE").toLowerCase(),
      seoTitle: String(node.seo?.title || "").trim(),
      seoDescription: String(node.seo?.description || "").trim(),
      attributes: attrs,
      sourceCreatedAt: node.createdAt || null,
      publishedAt: node.publishedAt || null,
      images: raw.images,
      collections: raw.collections.map((c) => ({
        shopifyCollectionId: c.id,
        handle: c.handle,
        title: c.title,
      })),
      variants,
    });
  }

  const valid = items.filter((p) => p.handle && p.title);
  console.log(
    `Export geparseerd: ${valid.length} producten, ${valid.reduce((n, p) => n + p.variants.length, 0)} varianten.`
  );
  const stats = await upsertCatalog(valid);
  console.log("Import klaar:", stats);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
