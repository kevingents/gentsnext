import "../lib/load-env";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { orders, orderLines, customers } from "../db/schema";

/**
 * Eenmalige backfill van historische Shopify-orders + klanten naar de gentsnext-
 * DB. Schrijft RECHTSTREEKS in orders/order_lines/customers — raakt NOOIT de
 * Mollie-webhook of de mail-/notify-paden, dus er gaat GEEN enkele mail naar
 * klanten. Idempotent: orders via uniek orderNumber, klanten via uniek e-mail.
 *
 *   npx tsx scripts/import-shopify-orders.ts --dry-run     # tellen, niets schrijven
 *   npx tsx scripts/import-shopify-orders.ts               # echt importeren
 *   npx tsx scripts/import-shopify-orders.ts --max=200     # eerste N orders (test)
 */

const SHOP = (process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_TOKEN || "";
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

const DRY = process.argv.includes("--dry-run") || process.argv.includes("--dry");
const MAX = (() => {
  const a = process.argv.find((x) => x.startsWith("--max="));
  return a ? Math.max(0, parseInt(a.split("=")[1], 10) || 0) : 0;
})();

const cents = (s: string | null | undefined) => Math.round(parseFloat(String(s ?? "0")) * 100);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://${SHOP}/admin/api/${VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const j: any = await res.json();
    const throttled = Array.isArray(j?.errors) && j.errors.some((e: any) => e?.extensions?.code === "THROTTLED");
    if (throttled) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok || j.errors) {
      throw new Error(`Shopify GraphQL ${res.status}: ${JSON.stringify(j.errors ?? j).slice(0, 400)}`);
    }
    return j.data as T;
  }
  throw new Error("Shopify GraphQL: te vaak throttled.");
}

/* ── Klanten ── */
const CUSTOMERS_Q = `
query Customers($cursor: String) {
  customers(first: 100, after: $cursor, sortKey: CREATED_AT) {
    edges { node {
      email firstName lastName phone createdAt
      emailMarketingConsent { marketingState }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;

async function importCustomers(db: ReturnType<typeof getDb>) {
  let cursor: string | null = null;
  let seen = 0;
  let written = 0;
  for (;;) {
    const data = await gql<any>(CUSTOMERS_Q, { cursor });
    const conn = data.customers;
    for (const { node: c } of conn.edges) {
      const email = String(c.email || "").trim().toLowerCase();
      if (!email) continue;
      seen++;
      if (DRY) continue;
      const optIn = c.emailMarketingConsent?.marketingState === "SUBSCRIBED";
      await db
        .insert(customers)
        .values({
          email,
          firstName: String(c.firstName || "").slice(0, 120),
          lastName: String(c.lastName || "").slice(0, 120),
          phone: String(c.phone || "").slice(0, 40),
          marketingOptIn: optIn,
          createdAt: c.createdAt ? new Date(c.createdAt) : undefined,
        })
        .onConflictDoUpdate({
          target: customers.email,
          set: {
            firstName: sql`coalesce(nullif(excluded.first_name, ''), ${customers.firstName})`,
            lastName: sql`coalesce(nullif(excluded.last_name, ''), ${customers.lastName})`,
            phone: sql`coalesce(nullif(excluded.phone, ''), ${customers.phone})`,
            updatedAt: sql`now()`,
          },
        });
      written++;
    }
    process.stdout.write(`\r  klanten: ${seen} gezien…`);
    if (MAX && seen >= MAX) break;
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  process.stdout.write("\n");
  return { seen, written };
}

/* ── Orders ── */
const ORDERS_Q = `
query Orders($cursor: String) {
  orders(first: 25, after: $cursor, sortKey: CREATED_AT, query: "status:any") {
    edges { node {
      name createdAt processedAt email phone
      displayFinancialStatus displayFulfillmentStatus
      customer { firstName lastName email }
      shippingAddress { address1 address2 zip city countryCodeV2 name phone }
      subtotalPriceSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 50) { edges { node {
        sku title quantity
        originalUnitPriceSet { shopMoney { amount } }
        variant { sku barcode selectedOptions { name value } }
      } } }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;

function mapFinancial(fin: string): { status: string; paymentStatus: string } {
  const f = String(fin || "").toUpperCase();
  if (f === "PAID" || f === "PARTIALLY_REFUNDED") return { status: "paid", paymentStatus: "paid" };
  if (f === "REFUNDED") return { status: "refunded", paymentStatus: "refunded" };
  return { status: "open", paymentStatus: f.toLowerCase() || "open" };
}
function mapFulfillment(ff: string): string {
  const f = String(ff || "").toUpperCase();
  return f === "FULFILLED" || f === "PARTIALLY_FULFILLED" ? "shipped" : "pending";
}
function optVal(opts: any[], re: RegExp): string {
  const o = (opts || []).find((x) => re.test(String(x?.name || "")));
  return o ? String(o.value || "") : "";
}

async function importOrders(db: ReturnType<typeof getDb>, emailToId: Map<string, string>) {
  let cursor: string | null = null;
  let seen = 0;
  let inserted = 0;
  let skipped = 0;
  let lineCount = 0;
  const sample: string[] = [];

  for (;;) {
    const data = await gql<any>(ORDERS_Q, { cursor });
    const conn = data.orders;
    for (const { node: o } of conn.edges) {
      seen++;
      const orderNumber = String(o.name || "").replace(/^#/, "").trim();
      if (!orderNumber) continue;
      const email = String(o.email || o.customer?.email || "").trim();
      const addr = o.shippingAddress || {};
      const nameParts = String(addr.name || "").trim().split(/\s+/);
      const firstName = String(o.customer?.firstName || nameParts[0] || "").slice(0, 120);
      const lastName = String(o.customer?.lastName || nameParts.slice(1).join(" ") || "").slice(0, 120);
      const fin = mapFinancial(o.displayFinancialStatus);
      const subtotalCents = cents(o.subtotalPriceSet?.shopMoney?.amount);
      const shippingCents = cents(o.totalShippingPriceSet?.shopMoney?.amount);
      const discountCents = cents(o.totalDiscountsSet?.shopMoney?.amount);
      const totalCents = cents(o.totalPriceSet?.shopMoney?.amount);
      const lines = (o.lineItems?.edges || []).map(({ node: li }: any) => ({
        sku: String(li.sku || li.variant?.sku || li.variant?.barcode || "").slice(0, 120),
        title: String(li.title || "").slice(0, 300),
        size: optVal(li.variant?.selectedOptions, /maat|size|lengte/i).slice(0, 40),
        color: optVal(li.variant?.selectedOptions, /kleur|colou?r/i).slice(0, 60),
        unitPriceCents: cents(li.originalUnitPriceSet?.shopMoney?.amount),
        quantity: Math.max(1, Number(li.quantity) || 1),
      }));

      if (sample.length < 5) {
        sample.push(`  #${orderNumber} · ${email || "—"} · ${fin.status} · ${(totalCents / 100).toFixed(2)} · ${lines.length} regels`);
      }

      if (DRY) continue;

      const [row] = await db
        .insert(orders)
        .values({
          orderNumber,
          status: fin.status,
          customerId: email ? emailToId.get(email.toLowerCase()) ?? null : null,
          email,
          firstName,
          lastName,
          phone: String(o.phone || addr.phone || "").slice(0, 40),
          street: String(addr.address1 || "").slice(0, 200),
          houseNumber: String(addr.address2 || "").slice(0, 60),
          postalCode: String(addr.zip || "").slice(0, 20),
          city: String(addr.city || "").slice(0, 120),
          country: String(addr.countryCodeV2 || "NL").slice(0, 4),
          deliveryMethod: "standard",
          discountCents,
          subtotalCents,
          shippingCents,
          totalCents,
          currency: String(o.totalPriceSet?.shopMoney?.currencyCode || "EUR"),
          paymentStatus: fin.paymentStatus,
          paidAt: fin.status === "paid" ? new Date(o.processedAt || o.createdAt) : null,
          fulfillmentStatus: mapFulfillment(o.displayFulfillmentStatus),
          createdAt: o.createdAt ? new Date(o.createdAt) : undefined,
        })
        .onConflictDoNothing({ target: orders.orderNumber })
        .returning({ id: orders.id });

      if (!row) {
        skipped++;
        continue;
      }
      inserted++;
      if (lines.length) {
        await db.insert(orderLines).values(lines.map((l) => ({ orderId: row.id, ...l })));
        lineCount += lines.length;
      }
    }
    process.stdout.write(`\r  orders: ${seen} gezien · ${inserted} nieuw · ${skipped} bestond al…`);
    if (MAX && seen >= MAX) break;
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  process.stdout.write("\n");
  return { seen, inserted, skipped, lineCount, sample };
}

async function main() {
  if (!SHOP || !TOKEN) throw new Error("SHOPIFY_SHOP_DOMAIN + SHOPIFY_ADMIN_ACCESS_TOKEN zijn vereist.");
  console.log(`Shopify-import → ${SHOP} (api ${VERSION})  ${DRY ? "[DRY-RUN — niets schrijven]" : "[ECHT importeren]"}${MAX ? ` [max ${MAX}]` : ""}`);
  console.log("Géén e-mails: directe DB-inserts, geen webhook/notify.\n");
  const db = getDb();

  console.log("1/2 Klanten…");
  const cust = await importCustomers(db);
  console.log(`   klanten: ${cust.seen} gezien, ${DRY ? "0 (dry)" : cust.written} weggeschreven.\n`);

  // E-mail → customerId map voor order-koppeling.
  const emailToId = new Map<string, string>();
  if (!DRY) {
    const rows = await db.select({ id: customers.id, email: customers.email }).from(customers);
    for (const r of rows) emailToId.set(r.email.toLowerCase(), r.id);
  }

  console.log("2/2 Orders…");
  const ord = await importOrders(db, emailToId);
  console.log(`   orders: ${ord.seen} gezien, ${DRY ? "0 (dry)" : ord.inserted} nieuw, ${ord.skipped} bestond al, ${ord.lineCount} orderregels.`);
  console.log("\nVoorbeeld-orders:");
  console.log(ord.sample.join("\n"));
  console.log(`\nKlaar.${DRY ? " (DRY-RUN — niets geschreven; draai zonder --dry-run om te importeren.)" : ""}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\nFOUT:", e instanceof Error ? e.message : e);
  process.exit(1);
});
