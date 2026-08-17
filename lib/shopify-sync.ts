import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, orderLines, customers } from "@/db/schema";
import { koppelIdentiteit } from "@/lib/identity";

/**
 * Doorlopende Shopify-sync: haal de orders op die er sinds de vorige keer bij
 * kwamen.
 *
 * Waarom dit moet bestaan. Het klantprofiel zag er compleet uit maar stond stil:
 * de orders in Neon houden op in juni 2026 (juli 2, augustus 5). Die 28.439
 * orders zijn de eenmalige historische import — gents.nl draait nog op Shopify,
 * dus élke bestelling van vandaag landt daar en niet hier. Een 360-profiel dat
 * de laatste twee maanden mist is geen profiel maar een archief: een klant die
 * vorige week kocht staat als "slapend" in de segmentatie en krijgt een
 * terugwin-mail.
 *
 * Verschil met scripts/import-shopify-orders.ts: dat loopt élke order van het
 * begin af aan door (eenmalige backfill). Deze functie vraagt Shopify alleen om
 * wat er ná een datum bij kwam, en is dus goedkoop genoeg om elk uur te draaien.
 *
 * Net als de backfill schrijft dit RECHTSTREEKS in orders/order_lines/customers
 * en raakt het nooit de Mollie-webhook of de mailpaden. Er gaat dus geen enkele
 * mail naar een klant. `fulfillmentStatus: "imported"` zorgt dat geen enkele
 * SRS-push-job deze orders oppakt — ze zijn in Shopify al afgehandeld.
 */

const SHOP = (process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_TOKEN || "";
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

export function shopifyGeconfigureerd(): boolean {
  return Boolean(SHOP && TOKEN);
}

const cents = (s: string | null | undefined) => Math.round(parseFloat(String(s ?? "0")) * 100);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Geëxporteerd zodat lib/shopify-media.ts dezelfde client gebruikt. Bewust niet
 * kopiëren: de THROTTLED-afhandeling hieronder (Shopify meldt een overschreden
 * quotum in een HTTP 200) is precies het soort detail dat in een tweede kopie
 * ontbreekt, en dan synct die stil niets.
 */
export async function shopifyGraphql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  return gql(query, variables);
}

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  for (let poging = 0; poging < 6; poging++) {
    const res = await fetch(`https://${SHOP}/admin/api/${VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) {
      await sleep(2000 * (poging + 1));
      continue;
    }
    const j: any = await res.json();
    // Shopify meldt een overschreden queryquotum niet met een 429 maar met een
    // THROTTLED-fout in een 200. Wie alleen op de statuscode kijkt, ziet een
    // "geslaagde" call met een lege uitkomst en synct stil niets.
    const throttled = Array.isArray(j?.errors) && j.errors.some((e: any) => e?.extensions?.code === "THROTTLED");
    if (throttled) {
      await sleep(2000 * (poging + 1));
      continue;
    }
    if (!res.ok || j.errors) {
      throw new Error(`Shopify GraphQL ${res.status}: ${JSON.stringify(j.errors ?? j).slice(0, 300)}`);
    }
    return j.data;
  }
  throw new Error("Shopify GraphQL: te vaak throttled.");
}

const ORDERS_Q = `
query Orders($cursor: String, $q: String!) {
  orders(first: 25, after: $cursor, sortKey: CREATED_AT, query: $q) {
    edges { node {
      name createdAt processedAt email phone
      displayFinancialStatus
      customer { firstName lastName email }
      shippingAddress { address1 address2 zip city countryCodeV2 name phone }
      subtotalPriceSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount currencyCode } }
      paymentGatewayNames
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

function optVal(opts: any[], re: RegExp): string {
  const o = (opts || []).find((x) => re.test(String(x?.name || "")));
  return o ? String(o.value || "") : "";
}

export type SyncResultaat = {
  vanaf: string;
  gezien: number;
  nieuw: number;
  bestond: number;
  regels: number;
  nieuweKlanten: number;
  ms: number;
};

/**
 * @param sindsUren  Hoe ver terug minimaal kijken. Standaard 48 uur overlap op
 *                   de nieuwste order in de database. Die overlap is bewust:
 *                   een order die in Shopify pas later betaald wordt verandert
 *                   van status zonder dat `createdAt` meebeweegt, en zonder
 *                   marge mis je hem voorgoed.
 */
export async function syncShopifyOrders(
  opts: { sindsUren?: number; maxOrders?: number; vanaf?: Date; tot?: Date } = {},
): Promise<SyncResultaat> {
  const start = Date.now();
  if (!shopifyGeconfigureerd()) throw new Error("SHOPIFY_SHOP_DOMAIN + SHOPIFY_ADMIN_ACCESS_TOKEN ontbreken.");
  const db = getDb();
  const maxOrders = opts.maxOrders ?? 2000;

  // Vertrekpunt: expliciet meegegeven, anders de nieuwste order die we al
  // hebben min de overlap. Het expliciete venster is er voor de eenmalige
  // inhaalslag: Shopify levert op CREATED_AT oplopend, dus zonder bovengrens
  // loop je bij een tweede poging opnieuw tegen dezelfde eerste orders aan en
  // kom je nooit voorbij de limiet.
  const [laatste] = await db
    .select({ t: sql<string | null>`max(coalesce(${orders.paidAt}, ${orders.createdAt}))` })
    .from(orders);
  const overlapUren = opts.sindsUren ?? 48;
  const vanafDatum =
    opts.vanaf ??
    (laatste?.t ? new Date(new Date(laatste.t).getTime() - overlapUren * 3600_000) : new Date(Date.now() - 90 * 86400_000));
  const vanaf = vanafDatum.toISOString();
  const totFilter = opts.tot ? ` AND created_at:<'${opts.tot.toISOString()}'` : "";

  let cursor: string | null = null;
  let gezien = 0;
  let nieuw = 0;
  let bestond = 0;
  let regelAantal = 0;
  let nieuweKlanten = 0;

  for (;;) {
    const data = await gql(ORDERS_Q, { cursor, q: `created_at:>='${vanaf}'${totFilter} AND status:any` });
    const conn = data.orders;

    const orderVals: (typeof orders.$inferInsert)[] = [];
    const regelsPerNummer = new Map<string, Omit<typeof orderLines.$inferInsert, "orderId">[]>();
    const gezienNummer = new Set<string>();

    for (const { node: o } of conn.edges) {
      gezien++;
      const orderNumber = String(o.name || "").replace(/^#/, "").trim();
      if (!orderNumber || gezienNummer.has(orderNumber)) continue;

      const email = String(o.email || o.customer?.email || "").trim().toLowerCase();
      const addr = o.shippingAddress || {};
      const naamDelen = String(addr.name || "").trim().split(/\s+/);
      const firstName = String(o.customer?.firstName || naamDelen[0] || "").slice(0, 120);
      const lastName = String(o.customer?.lastName || naamDelen.slice(1).join(" ") || "").slice(0, 120);
      const fin = mapFinancial(o.displayFinancialStatus);

      // Klant meteen aanmaken/bijwerken: anders landt de order zonder
      // customerId en telt hij nergens mee in het profiel. Lege velden worden
      // aangevuld, gevulde nooit overschreven — de klant is de baas over zijn
      // eigen naam.
      let customerId: string | null = null;
      if (email) {
        const [rij] = await db
          .insert(customers)
          .values({ email, firstName, lastName, phone: String(o.phone || addr.phone || "").slice(0, 40) })
          .onConflictDoUpdate({
            target: customers.email,
            set: {
              firstName: sql`case when ${customers.firstName} = '' then excluded.first_name else ${customers.firstName} end`,
              lastName: sql`case when ${customers.lastName} = '' then excluded.last_name else ${customers.lastName} end`,
              phone: sql`case when ${customers.phone} = '' then excluded.phone else ${customers.phone} end`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: customers.id, aangemaakt: sql<boolean>`(xmax = 0)` });
        customerId = rij?.id ?? null;
        if (rij?.aangemaakt) nieuweKlanten++;
        if (customerId) await koppelIdentiteit(customerId, "email", email, { bron: "shopify" });
      }

      gezienNummer.add(orderNumber);
      orderVals.push({
        orderNumber,
        status: fin.status,
        customerId,
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
        // Wélke betaalmethode de klant koos stond tot nu toe nergens vast.
        // Shopify noemt de gateway; dat is precies wat we willen weten.
        betaalmethode: String((o.paymentGatewayNames || [])[0] || "").slice(0, 60),
        discountCents: cents(o.totalDiscountsSet?.shopMoney?.amount),
        subtotalCents: cents(o.subtotalPriceSet?.shopMoney?.amount),
        shippingCents: cents(o.totalShippingPriceSet?.shopMoney?.amount),
        totalCents: cents(o.totalPriceSet?.shopMoney?.amount),
        currency: String(o.totalPriceSet?.shopMoney?.currencyCode || "EUR"),
        paymentStatus: fin.paymentStatus,
        paidAt: fin.status === "paid" ? new Date(o.processedAt || o.createdAt) : null,
        // Nooit 'pending': anders pakt een SRS-push-job een order op die in
        // Shopify allang verwerkt is en gaat hij dubbel het magazijn in.
        fulfillmentStatus: "imported",
        createdAt: o.createdAt ? new Date(o.createdAt) : undefined,
      });

      regelsPerNummer.set(
        orderNumber,
        (o.lineItems?.edges || []).map(({ node: li }: any) => ({
          sku: String(li.sku || li.variant?.sku || li.variant?.barcode || "").slice(0, 120),
          title: String(li.title || "").slice(0, 300),
          size: optVal(li.variant?.selectedOptions, /maat|size|lengte/i).slice(0, 40),
          color: optVal(li.variant?.selectedOptions, /kleur|colou?r/i).slice(0, 60),
          unitPriceCents: cents(li.originalUnitPriceSet?.shopMoney?.amount),
          quantity: Math.max(1, Number(li.quantity) || 1),
        })),
      );
    }

    if (orderVals.length) {
      // Bestaat de order al, dan alleen de STATUS bijwerken. Dat is het hele
      // punt van de overlap: een order die gisteren 'open' was en vandaag
      // betaald, telt anders nooit mee als omzet.
      const rijen = await db
        .insert(orders)
        .values(orderVals)
        .onConflictDoUpdate({
          target: orders.orderNumber,
          set: {
            status: sql`excluded.status`,
            paymentStatus: sql`excluded.payment_status`,
            paidAt: sql`coalesce(${orders.paidAt}, excluded.paid_at)`,
            betaalmethode: sql`coalesce(nullif(excluded.betaalmethode, ''), ${orders.betaalmethode})`,
            customerId: sql`coalesce(${orders.customerId}, excluded.customer_id)`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: orders.id, orderNumber: orders.orderNumber, nieuw: sql<boolean>`(xmax = 0)` });

      const regelVals: (typeof orderLines.$inferInsert)[] = [];
      for (const r of rijen) {
        if (r.nieuw) {
          nieuw++;
          for (const l of regelsPerNummer.get(r.orderNumber) || []) regelVals.push({ orderId: r.id, ...l });
        } else {
          bestond++;
        }
      }
      if (regelVals.length) {
        await db.insert(orderLines).values(regelVals);
        regelAantal += regelVals.length;
      }
    }

    if (gezien >= maxOrders) break;
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  return { vanaf, gezien, nieuw, bestond, regels: regelAantal, nieuweKlanten, ms: Date.now() - start };
}

/* ─────────────────── Klantvelden uit Shopify: het SRS-nummer ──────────────── */

const KLANTEN_Q = `
query Klanten($cursor: String, $q: String) {
  customers(first: 100, after: $cursor, sortKey: UPDATED_AT, reverse: true, query: $q) {
    edges { node {
      email
      srs: metafield(namespace: "SRSERP", key: "customer_id") { value }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Haalt het SRS-klantnummer uit Shopify en zet het op onze klant.
 *
 * Dit is de brug waarvan ik dacht dat hij ontbrak. Bij de meting had géén
 * enkele van de 48.000 klanten een SRS-nummer, waardoor de hele winkelkant van
 * het profiel leeg bleef en `kanaal` bij vrijwel iedereen op "online" stond. Ik
 * zocht de oplossing in de SRS-SOAP-API via storegents — maar Shopify heeft het
 * gewoon als metaveld `SRSERP.customer_id`, bij 79% van de recente klanten.
 *
 * Dat is de betere weg: geen SOAP, geen extra sleutels, en het nummer komt uit
 * dezelfde synchronisatie die de winkel al jaren draait.
 *
 * Alleen invullen waar het leeg is: een bestaand nummer overschrijven zou een
 * handmatige correctie ongedaan maken. En het gaat óók de identiteitsgrafiek in,
 * want dát is de plek waar de koppeling web ↔ winkel wordt gelegd.
 */
export async function syncShopifySrsNummers(
  opts: { maxKlanten?: number; sindsDagen?: number } = {},
): Promise<{ gezien: number; metNummer: number; gekoppeld: number; ms: number }> {
  const start = Date.now();
  if (!shopifyGeconfigureerd()) throw new Error("SHOPIFY_SHOP_DOMAIN + SHOPIFY_ADMIN_ACCESS_TOKEN ontbreken.");
  const db = getDb();
  const maxKlanten = opts.maxKlanten ?? 5000;
  // Standaard alleen recent gewijzigde klanten; de eerste volledige vulling
  // draai je met een ruime periode.
  const q = opts.sindsDagen
    ? `updated_at:>='${new Date(Date.now() - opts.sindsDagen * 86400_000).toISOString()}'`
    : null;

  let cursor: string | null = null;
  let gezien = 0;
  let metNummer = 0;
  let gekoppeld = 0;

  for (;;) {
    const data = await gql(KLANTEN_Q, { cursor, q });
    const conn = data.customers;

    for (const { node } of conn.edges) {
      gezien++;
      const email = String(node.email || "").trim().toLowerCase();
      const srs = String(node.srs?.value || "").trim();
      if (!email || !srs) continue;
      metNummer++;

      const rijen = await db
        .update(customers)
        .set({ srsCustomerId: srs, updatedAt: sql`now()` })
        .where(sql`lower(${customers.email}) = ${email} and coalesce(${customers.srsCustomerId}, '') = ''`)
        .returning({ id: customers.id });

      if (rijen.length) {
        gekoppeld++;
        // De identiteitsgrafiek is waar web en winkel elkaar vinden; zonder deze
        // regel staat het nummer wel op de klant maar kent de grafiek hem niet.
        await koppelIdentiteit(rijen[0].id, "srs", srs, { bron: "shopify-metaveld" });
      }
    }

    if (gezien >= maxKlanten) break;
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  return { gezien, metNummer, gekoppeld, ms: Date.now() - start };
}
