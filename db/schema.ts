import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Commerce-DB van gentsnext — system of record voor de productcatalogus.
 *
 * Ontwerpregels (zie docs/BLAUWDRUK in README):
 *  - Geldbedragen altijd integer centen (EUR), nooit floats.
 *  - Shopify-ID's worden bevroren bewaard (shopify_*) voor feed-continuïteit
 *    (Google Merchant Center / Squeezely behandelen een gewijzigd feed-ID als
 *    nieuw product) en voor de migratie-mapping.
 *  - SRS-koppelvelden (artikel_id, rve_artikelnummer) zijn de brug naar het
 *    ERP/kassasysteem en mogen nooit verloren gaan.
 *  - Prijshistorie per variant is wettelijk nodig (Omnibus: "van"-prijs =
 *    laagste prijs in 30 dagen vóór de korting).
 */

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handle: text("handle").notNull(),
    title: text("title").notNull(),
    descriptionHtml: text("description_html").notNull().default(""),
    vendor: text("vendor").notNull().default(""),
    productType: text("product_type").notNull().default(""),
    /** 'active' | 'draft' | 'archived' */
    status: text("status").notNull().default("active"),
    seoTitle: text("seo_title").notNull().default(""),
    seoDescription: text("seo_description").notNull().default(""),
    /** Bevroren Shopify-GID (gid://shopify/Product/...) — migratie & feeds. */
    shopifyProductId: text("shopify_product_id"),
    /**
     * Vrije attributen: SRSERP-productmetafields (subgroep, hoofdgroep,
     * materiaal, pasvorm, ...) plus migratie-restanten (_collectionTitles,
     * _videos). Sleutels volgen de oude metafield-keys.
     */
    attributes: jsonb("attributes").notNull().default({}),
    /** createdAt van het bronproduct in Shopify (cache-veld `createdAt`). */
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /**
     * Gedenormaliseerde zichtbaarheidsvlaggen — gevuld door scripts/sync-stock.
     * Catalogus toont alleen producten met foto ÉN voorraad (eis: geen lege
     * kaarten of niet-leverbare artikelen).
     */
    hasImage: boolean("has_image").notNull().default(false),
    inStock: boolean("in_stock").notNull().default(false),
    stockQty: integer("stock_qty").notNull().default(0),
    stockSyncedAt: timestamp("stock_synced_at", { withTimezone: true }),
    /** AI-gegenereerde modelfoto (reguliere pasvorm) — leidt de galerij ("model eerst"). */
    modelImageUrl: text("model_image_url").notNull().default(""),
    modelImageAlt: text("model_image_alt").notNull().default(""),
    /** AI-gegenereerde productvideo (uit de modelfoto, FASHN image-to-video) — speelt vooraan in de galerij. */
    modelVideoUrl: text("model_video_url").notNull().default(""),
    /** Tweede AI-modelpose (extra galerijbeeld na de leidende modelfoto). */
    modelImageUrl2: text("model_image_url2").notNull().default(""),
    modelImageAlt2: text("model_image_alt2").notNull().default(""),
    /** AI-detailfoto (close-up stof/revers) — derde galerijbeeld. */
    detailImageUrl: text("detail_image_url").notNull().default(""),
    detailImageAlt: text("detail_image_alt").notNull().default(""),
    /** AI-lifestyle/sfeerbeelden (model in setting, bv. mediterrane bruiloft of ruig Schotland) — apart van de studio-galerij, getoond als sfeerblok van 3. */
    lifestyleImageUrl: text("lifestyle_image_url").notNull().default(""),
    lifestyleImageAlt: text("lifestyle_image_alt").notNull().default(""),
    lifestyleImageUrl2: text("lifestyle_image_url2").notNull().default(""),
    lifestyleImageUrl3: text("lifestyle_image_url3").notNull().default(""),
    /** Kleurgroep-sleutel (uit titel afgeleid) voor het samenvoegen van kleurvarianten. */
    variantGroupKey: text("variant_group_key").notNull().default(""),
    /** Eén primair product per kleurgroep wordt in listings getoond. */
    isGroupPrimary: boolean("is_group_primary").notNull().default(true),
    /** Aantal kleuren in de groep (voor de "+N kleuren"-badge). */
    groupColorCount: integer("group_color_count").notNull().default(1),
    /** Kleurlabel van dít product binnen de groep (bv. "rood met stip"). */
    variantColorLabel: text("variant_color_label").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_handle_unique").on(t.handle),
    uniqueIndex("products_shopify_id_unique").on(t.shopifyProductId),
    index("products_status_idx").on(t.status),
    index("products_visible_idx").on(t.status, t.hasImage, t.inStock),
    index("products_variant_group_idx").on(t.variantGroupKey),
  ]
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().default(""),
    /** EAN/barcode — de join-sleutel naar SRS-voorraad (SFTP: sku_code). */
    barcode: text("barcode").notNull().default(""),
    position: integer("position").notNull().default(0),
    size: text("size").notNull().default(""),
    /** Lettermaat-bucket (XS/M/L/…) voor het maatfilter — afgeleid van size. */
    sizeLabel: text("size_label").notNull().default(""),
    color: text("color").notNull().default(""),
    /** Kleurfamilie (blauw/grijs/…) voor PLP-facetten — afgeleid van color. */
    colorFamily: text("color_family").notNull().default(""),
    priceCents: integer("price_cents").notNull(),
    compareAtCents: integer("compare_at_cents"),
    /** SRS-koppelvelden (uit SRSERP.* metafields / SRS-connector). */
    srsArtikelId: text("srs_artikel_id").notNull().default(""),
    srsRveArtikelnummer: text("srs_rve_artikelnummer").notNull().default(""),
    /** Bevroren Shopify-GID — feed_id voor Merchant Center/Squeezely. */
    shopifyVariantId: text("shopify_variant_id"),
    imageUrl: text("image_url").notNull().default(""),
    /** Voorraad per variant (som over filialen) — gevuld door scripts/sync-stock. */
    stockQty: integer("stock_qty").notNull().default(0),
    attributes: jsonb("attributes").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("variants_shopify_id_unique").on(t.shopifyVariantId),
    index("variants_product_idx").on(t.productId),
    index("variants_sku_idx").on(t.sku),
    index("variants_barcode_idx").on(t.barcode),
    index("variants_srs_artikel_idx").on(t.srsArtikelId),
    index("variants_color_family_idx").on(t.colorFamily),
    index("variants_size_idx").on(t.size),
    index("variants_size_label_idx").on(t.sizeLabel),
  ]
);

/**
 * Prijshistorie — elke prijswijziging een rij. De storefront berekent hieruit
 * de 30-dagen-laagste referentieprijs (Omnibus). Marketeers krijgen géén vrij
 * "van"-prijsveld.
 */
/**
 * Alternatieve modelfoto voor grote maten — getoond zodra een maat ≥ threshold
 * gekozen wordt (inclusief passende fotografie). Per product instelbaar.
 */
export const productSizeMedia = pgTable("product_size_media", {
  productId: uuid("product_id")
    .primaryKey()
    .references(() => products.id, { onDelete: "cascade" }),
  threshold: text("threshold").notNull().default("XXL"),
  url: text("url").notNull(),
  alt: text("alt").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** AI-vertalingen van producten per locale (titel/omschrijving/SEO). */
export const productTranslations = pgTable(
  "product_translations",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    title: text("title").notNull().default(""),
    descriptionHtml: text("description_html").notNull().default(""),
    seoTitle: text("seo_title").notNull().default(""),
    seoDescription: text("seo_description").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.locale] })]
);

/**
 * Omnichannel voorraad-grootboek (de "core"). Append-only kassa/web-mutaties
 * bovenop de SRS-magazijn-baseline: beschikbaar = SRS-baseline + Σ delta.
 * De zelfgebouwde kassa (storegents) ÉN de webshop schrijven hier transactioneel
 * → één bron van waarheid voor winkelvoorraad, geen dubbelverkoop.
 *  location  = winkelnaam ("GENTS Amsterdam") of "magazijn"
 *  stockKey  = lower(barcode || sku || artikelnummer) — zelfde sleutel als SRS/kassa
 *  delta     = − verkoop/reservering · + inboeken/retour/vrijgave
 *  channel   = 'pos' | 'web' | 'correction'
 *  ref       = saleId/orderNumber/clientRef → idempotentie (NULL = geen)
 */
export const storeStockMovements = pgTable(
  "store_stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    location: text("location").notNull(),
    stockKey: text("stock_key").notNull(),
    delta: integer("delta").notNull(),
    channel: text("channel").notNull().default("web"),
    reason: text("reason").notNull().default(""),
    ref: text("ref"),
    meta: jsonb("meta"),
    // Gezet zodra de bijbehorende kassa-verkoop in SRS is geboekt. De delta telt
    // dan nog mee tot een SRS-sync ná dit moment draait (= de baseline neemt 'm
    // over); daarna valt 'ie uit de posDelta-som → geen dubbeltelling.
    srsPostedAt: timestamp("srs_posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ssm_loc_key_idx").on(t.location, t.stockKey),
    // Idempotentie: dezelfde (ref, kanaal, sku) boekt niet dubbel. NULL-ref mag vrij.
    uniqueIndex("ssm_ref_unique").on(t.ref, t.channel, t.stockKey),
    index("ssm_ref_idx").on(t.ref),
  ],
);

/**
 * SRS-voorraadbaseline in Neon (vervangt de cross-repo blob
 * `srs-voorraad/srs-rows-latest.json` die de webshop las via een gedeeld
 * storegents-blob-token). Bron van waarheid voor de bruto fysieke voorraad per
 * SKU per filiaal; de kassa/web-delta (store_stock_movements) en web-reserveringen
 * worden er bovenop verrekend (lib/stock-reservations, lib/store-core).
 *
 * De storegents SRS-import (3×/dag) pusht de volledige snapshot in batches onder
 * één `gen` (= `<epoch-ms>-<uuid>`, chronologisch sorteerbaar) en commit daarna: de
 * flip van srs_stock_meta.active_gen is MONOTOON (alleen vooruit naar een nieuwere gen)
 * en de cleanup verwijdert uitsluitend STRIKT OUDERE generaties. Reads filteren op
 * active_gen, dus een half-geschreven sync wordt nooit getoond. Twee gelijktijdige
 * imports (cron + handmatige admin-trigger) kunnen elkaar zo niet afknotten — nodig
 * omdat de neon-http-driver geen transactie/lock kent die begin→upsert→commit
 * serialiseert. Zie commitBaselineGen in lib/srs-stock-core.ts.
 */
export const srsStock = pgTable(
  "srs_stock",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gen: text("gen").notNull(),
    sku: text("sku").notNull(),
    branchId: text("branch_id").notNull(),
    store: text("store").notNull().default(""),
    qty: integer("qty").notNull().default(0),
    tekort: integer("tekort").notNull().default(0),
    ideaal: integer("ideaal").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Reads: WHERE gen = active_gen [AND sku IN (...)]. Één index dekt beide.
    index("srs_stock_gen_sku_idx").on(t.gen, t.sku),
    // Eén rij per (gen, filiaal, sku) → upsert-idempotent bij batch-retries.
    uniqueIndex("srs_stock_gen_branch_sku_unique").on(t.gen, t.branchId, t.sku),
  ],
);

/**
 * Pointer naar de actieve SRS-voorraadgeneratie (één rij, id='latest'). De commit
 * van een sync zet active_gen + synced_at atomair; reads lezen deze rij eerst.
 */
export const srsStockMeta = pgTable("srs_stock_meta", {
  id: text("id").primaryKey(), // altijd 'latest'
  activeGen: text("active_gen"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  rowCount: integer("row_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Print-inbox: wachtrij van print-opdrachten per winkel. De backend kan een winkel niet
 * direct laten printen (de kassa-agent zit op localhost achter NAT), dus een opdracht wordt
 * hier gequeued; de kassa van díe winkel pollt de inbox en print 'm via z'n lokale agent
 * (en ackt 'm). Gebruikt voor de winkel→winkel-uitwisseling: de bronwinkel krijgt een
 * pick-opdracht met scanbare barcode (ref = shipment linkRef → koppelt de scan aan de zending).
 */
export const storePrintJobs = pgTable(
  "store_print_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    store: text("store").notNull(), // winkel die moet printen
    type: text("type").notNull().default("pick"), // 'pick' | 'note' | ...
    ref: text("ref").notNull().default(""), // shipment linkRef e.d. (idempotentie + scan-koppeling)
    payload: jsonb("payload").notNull().default({}), // wat te printen (titel/barcode/regels/voor-winkel/eta)
    status: text("status").notNull().default("pending"), // 'pending' | 'printed' | 'cancelled'
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    printedAt: timestamp("printed_at", { withTimezone: true }),
  },
  (t) => [
    index("spj_store_status_idx").on(t.store, t.status),
    // Idempotentie: dezelfde (store, ref, type) queuet niet dubbel bij retries — alleen als
    // er een ref is (lege-ref-opdrachten mogen wél meerdere keren).
    uniqueIndex("spj_store_ref_type_unique").on(t.store, t.ref, t.type).where(sql`ref <> ''`),
  ],
);

/**
 * Fase D — anti-oversell. Atomaire web-reserveringsteller per (locatie, stockKey).
 * De gate bij het aanmaken van een order is één SQL-statement (ON CONFLICT DO
 * UPDATE ... WHERE) → de rij-lock serialiseert gelijktijdige checkouts, zodat het
 * laatste stuk maar één keer gereserveerd kan worden. 'online' = de web-pool.
 */
export const webStockReservationCounter = pgTable(
  "web_stock_reservation_counter",
  {
    location: text("location").notNull(),
    stockKey: text("stock_key").notNull(),
    reserved: integer("reserved").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.location, t.stockKey] })],
);

/**
 * Individuele web-holds (per order) met TTL. Voeden de teller en maken gerichte
 * vrijgave (betaald+gepland → afgeleide reservering neemt over; betaling mislukt
 * → vrij) en expiry (verlaten checkout) mogelijk. Eén statement decrementeert de
 * teller + ruimt de hold op, zodat teller en holds in sync blijven.
 */
export const webStockHolds = pgTable(
  "web_stock_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    location: text("location").notNull(),
    stockKey: text("stock_key").notNull(),
    qty: integer("qty").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wsh_order_idx").on(t.orderId),
    index("wsh_loc_key_idx").on(t.location, t.stockKey),
    index("wsh_expires_idx").on(t.expiresAt),
  ],
);

export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(),
    compareAtCents: integer("compare_at_cents"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("price_history_variant_idx").on(t.variantId, t.validFrom)]
);

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handle: text("handle").notNull(),
    title: text("title").notNull(),
    descriptionHtml: text("description_html").notNull().default(""),
    seoTitle: text("seo_title").notNull().default(""),
    seoDescription: text("seo_description").notNull().default(""),
    /** Bevroren Shopify-GID + numeriek ID (Squeezely category_ids!). */
    shopifyCollectionId: text("shopify_collection_id"),
    /** Smart-collection-regels uit de Shopify-export (jsonb, informatief). */
    rules: jsonb("rules"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("collections_handle_unique").on(t.handle),
    uniqueIndex("collections_shopify_id_unique").on(t.shopifyCollectionId),
  ]
);

export const productCollections = pgTable(
  "product_collections",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.collectionId] })]
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    alt: text("alt").notNull().default(""),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("images_product_idx").on(t.productId, t.position)]
);

/**
 * Voorraadspiegel per SRS-filiaal. Bron: SRS (SFTP-snapshots + GetStock-delta's,
 * gevuld door storegents-crons). Bewust op SKU — SRS kan SKU's hebben die
 * (nog) niet in de webcatalogus staan.
 */
export const stockLevels = pgTable(
  "stock_levels",
  {
    sku: text("sku").notNull(),
    branchId: text("branch_id").notNull(),
    quantity: integer("quantity").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sku, t.branchId] })]
);

/**
 * Bestellingen — eigen ordermodel (commerce-core), bron van waarheid voor de
 * checkout. Bedragen in integer centen. Statusmachine:
 *   open → paid | failed | expired | canceled ; paid → shipped | refunded.
 * paymentStatus spiegelt de Mollie-betaalstatus (webhook = bron van waarheid).
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderNumber: text("order_number").notNull(),
    status: text("status").notNull().default("open"),
    /** Koppeling aan een klantaccount (nullable: gast-checkout blijft mogelijk). */
    customerId: uuid("customer_id"),
    /** Niet-raadbaar token voor de (gast-)bevestigingslink — beschermt tegen IDOR. */
    accessToken: text("access_token"),
    email: text("email").notNull(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    phone: text("phone").notNull().default(""),
    street: text("street").notNull().default(""),
    houseNumber: text("house_number").notNull().default(""),
    postalCode: text("postal_code").notNull().default(""),
    city: text("city").notNull().default(""),
    country: text("country").notNull().default("NL"),
    /** Zakelijk bestellen (optioneel): bedrijfsnaam + BTW-nummer. */
    companyName: text("company_name").notNull().default(""),
    vatNumber: text("vat_number").notNull().default(""),
    /** 'standard' | 'express' (snellere levering tegen toeslag) | 'pickup' (afhalen in winkel). */
    deliveryMethod: text("delivery_method").notNull().default("standard"),
    /** Bij 'pickup': de winkel waar de klant afhaalt (winkelnaam, bv. "GENTS Groningen"). */
    pickupStore: text("pickup_store").notNull().default(""),
    voucherCode: text("voucher_code").notNull().default(""),
    discountCents: integer("discount_cents").notNull().default(0),
    /** Cadeaubon als betaalmiddel: ingezette code + afgeboekt bedrag (centen). */
    giftcardCode: text("giftcard_code").notNull().default(""),
    giftcardCents: integer("giftcard_cents").notNull().default(0),
    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    /** Mollie */
    molliePaymentId: text("mollie_payment_id"),
    paymentStatus: text("payment_status"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** SRS-weborder-push-status (na betaling) — voor de latere koppeling. */
    srsPushedAt: timestamp("srs_pushed_at", { withTimezone: true }),
    /** Allocatieplan (welke filialen leveren wat) — lib/fulfillment. */
    fulfillmentPlan: jsonb("fulfillment_plan"),
    /** 'pending' | 'planned' | 'pushed' | 'partial' | 'failed'. */
    fulfillmentStatus: text("fulfillment_status").notNull().default("pending"),
    /** Orderbevestigingsmail verstuurd (idempotent — webhook kan dubbel komen). */
    confirmationSentAt: timestamp("confirmation_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_order_number_unique").on(t.orderNumber),
    uniqueIndex("orders_mollie_payment_unique").on(t.molliePaymentId),
    index("orders_status_idx").on(t.status),
  ]
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    productHandle: text("product_handle").notNull().default(""),
    title: text("title").notNull().default(""),
    size: text("size").notNull().default(""),
    color: text("color").notNull().default(""),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull().default(1),
    groupId: text("group_id"),
    roleLabel: text("role_label"),
  },
  (t) => [index("order_lines_order_idx").on(t.orderId)]
);

/** AI-support-tickets: klantvraag + AI-antwoord; geëscaleerd als de AI er niet uitkomt. */
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().default(""),
    question: text("question").notNull(),
    aiAnswer: text("ai_answer").notNull().default(""),
    confident: boolean("confident").notNull().default(false),
    status: text("status").notNull().default("open"), // answered | escalated
    handled: boolean("handled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_tickets_status_idx").on(t.status, t.createdAt)]
);

/**
 * Storefront-analytics (eigen, privacy-vriendelijk: anonieme session-id, geen
 * PII). Events: pageview, product_view, search, filter, add_to_cart, purchase,
 * stock_notify, … Voor trends/bestsellers en afhaak-analyse (Coolblue-stijl).
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: text("session_id").notNull().default(""),
    type: text("type").notNull(),
    path: text("path").notNull().default(""),
    handle: text("handle").notNull().default(""),
    query: text("query").notNull().default(""),
    valueCents: integer("value_cents").notNull().default(0),
    props: jsonb("props").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_type_time_idx").on(t.type, t.createdAt),
    index("events_handle_idx").on(t.handle),
    index("events_query_idx").on(t.query),
    index("events_session_idx").on(t.sessionId),
  ]
);

/**
 * Centrale instellingen-store (één rij, id='global'). Alle in de backend
 * instelbare knoppen (verzending, cutoffs, levertijd, toeslag, drempels,
 * veiligheidsvoorraad, …) staan hier als JSON. Zie lib/settings.
 */
export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey().default("global"),
  data: jsonb("data").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * "Mail me als het er weer is" — terug-op-voorraad-notificaties. Per product
 * (sku leeg = elke maat) of per specifieke maat (sku gezet). De voorraad-sync
 * (scripts/sync-catalog-flags) verstuurt de mail zodra de voorraad terug is.
 */
export const stockNotifications = pgTable(
  "stock_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    /** 'email' | 'whatsapp' | 'both'. */
    channel: text("channel").notNull().default("email"),
    productHandle: text("product_handle").notNull(),
    productTitle: text("product_title").notNull().default(""),
    /** Specifieke variant/maat; leeg = elke maat van het product. */
    sku: text("sku").notNull().default(""),
    size: text("size").notNull().default(""),
    color: text("color").notNull().default(""),
    status: text("status").notNull().default("pending"), // pending | notified | cancelled
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_notifications_unique").on(t.email, t.phone, t.productHandle, t.sku),
    index("stock_notifications_status_idx").on(t.status),
    index("stock_notifications_sku_idx").on(t.sku),
    index("stock_notifications_handle_idx").on(t.productHandle),
  ]
);

/* ─────────────────────────── Klanten & loyaliteit ───────────────────────── */

/**
 * Klantaccount — omnichannel. Gekoppeld aan online orders (orders.customerId)
 * én aan winkelaankopen (storePurchases) via srsCustomerId/e-mail, zodat een
 * klant in zijn profiel zowel online- als winkelaankopen ziet. Auth gaat via
 * een magic-link sessie (customerSessions); wachtwoord is optioneel voor later.
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    phone: text("phone").notNull().default(""),
    /** Optioneel wachtwoord (bcrypt) — magic-link is de primaire route. */
    passwordHash: text("password_hash"),
    /** SRS/POS-klantnummer — koppelt winkelaankopen aan dit account. */
    srsCustomerId: text("srs_customer_id"),
    /** Spaarpunten-saldo (afgeleid van loyaltyEvents, hier gecachet). */
    loyaltyPoints: integer("loyalty_points").notNull().default(0),
    /** Maatprofiel: { colbert, broek, overhemd, schoen, pasvoorkeur, ... }. */
    sizeProfile: jsonb("size_profile").notNull().default({}),
    /** Stijl-/maatvoorkeuren en notities (vrij). */
    preferences: jsonb("preferences").notNull().default({}),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    /** "Rond je profiel af voor +50 punten"-token (SHA256) + of de bonus al
     *  toegekend is (idempotent — één keer +50). */
    profileCompletionTokenHash: text("profile_completion_token_hash"),
    profileCompletionBonusClaimed: boolean("profile_completion_bonus_claimed").notNull().default(false),
    /** Beheerder — toegang tot de instellingen-backend. */
    isAdmin: boolean("is_admin").notNull().default(false),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Laatste keer dat de SRS-winkelhistorie is geïmporteerd (self-healing bij login,
     *  1× + wekelijkse refresh). Leeg = nog nooit gedaan. */
    storeHistoryImportedAt: timestamp("store_history_imported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customers_email_unique").on(t.email),
    index("customers_srs_idx").on(t.srsCustomerId),
  ]
);

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    label: text("label").notNull().default("Thuis"),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    street: text("street").notNull().default(""),
    houseNumber: text("house_number").notNull().default(""),
    postalCode: text("postal_code").notNull().default(""),
    city: text("city").notNull().default(""),
    country: text("country").notNull().default("NL"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("customer_addresses_customer_idx").on(t.customerId)]
);

/** Magic-link/sessie-tokens. Token = opaque, gehasht opgeslagen. */
export const customerSessions = pgTable(
  "customer_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** 'session' = ingelogd; 'magic' = nog te verzilveren login-link. */
    kind: text("kind").notNull().default("session"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customer_sessions_token_unique").on(t.tokenHash),
    index("customer_sessions_customer_idx").on(t.customerId),
  ]
);

/**
 * Vouchers/tegoedbonnen — kan persoonlijk (customerId) of generiek zijn.
 * Type 'amount' (valueCents) of 'percent' (percentOff).
 */
export const vouchers = pgTable(
  "vouchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    description: text("description").notNull().default(""),
    kind: text("kind").notNull().default("amount"),
    valueCents: integer("value_cents").notNull().default(0),
    percentOff: integer("percent_off").notNull().default(0),
    minSpendCents: integer("min_spend_cents").notNull().default(0),
    status: text("status").notNull().default("active"),
    email: text("email").notNull().default(""),
    singleUse: boolean("single_use").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("vouchers_code_unique").on(t.code),
    index("vouchers_customer_idx").on(t.customerId),
  ]
);

/** Spaarpunten-mutaties — saldo = som. Bron: online + winkelaankopen. */
export const loyaltyEvents = pgTable(
  "loyalty_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    points: integer("points").notNull(),
    reason: text("reason").notNull().default(""),
    refType: text("ref_type"),
    refId: text("ref_id"),
    /** Besteedbaar-vanaf (vesting). NULL = direct besteedbaar (bv. profielbonus,
     *  retour-correcties). Verdiende order/bon-punten staan tot deze datum "in
     *  behandeling" zodat een retour geen negatief saldo geeft. */
    vestsAt: timestamp("vests_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("loyalty_events_customer_idx").on(t.customerId),
    // Idempotentie voor punten-claims: één event per bron (pos_receipt:saleId,
    // web_order:orderId). Events zonder refId (bv. profile_completion) botsen niet —
    // NULLs zijn distinct in een unieke index.
    uniqueIndex("loyalty_events_ref_unique").on(t.refType, t.refId),
  ]
);

/**
 * Winkelaankopen (omnichannel) — uit SRS/POS. Gekoppeld aan een klant via
 * srsCustomerId of e-mail, zodat de klant ze in zijn profiel terugziet.
 */
export const storePurchases = pgTable(
  "store_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    srsCustomerId: text("srs_customer_id"),
    email: text("email"),
    storeName: text("store_name").notNull().default(""),
    branchId: text("branch_id"),
    receiptId: text("receipt_id"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
    totalCents: integer("total_cents").notNull().default(0),
    pointsEarned: integer("points_earned").notNull().default(0),
    /** Regels: [{ title, size, color, qty, unitPriceCents }]. */
    lines: jsonb("lines").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("store_purchases_customer_idx").on(t.customerId),
    index("store_purchases_srs_idx").on(t.srsCustomerId),
    index("store_purchases_email_idx").on(t.email),
  ]
);

/* ─────────────────────────── Productreviews ────────────────────────────── */

/**
 * Native productreviews (eigen, niet Judge.me). Een review hangt aan een
 * product (handle) en — indien gekoppeld aan een order — geldt als
 * geverifieerde aankoop. Niet-geverifieerde reviews komen op 'pending' en
 * worden gemodereerd in de backend; geverifieerde kopers publiceren direct.
 * Voor mode relevant: optionele pasvorm-feedback (valt klein/normaal/groot).
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productHandle: text("product_handle").notNull(),
    /** Order waaraan de review hangt (geverifieerde aankoop), optioneel. */
    orderNumber: text("order_number").notNull().default(""),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull().default(""),
    email: text("email").notNull().default(""),
    rating: integer("rating").notNull(), // 1–5
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    /** Pasvorm-feedback: '' | 'klein' | 'normaal' | 'groot'. */
    fit: text("fit").notNull().default(""),
    verified: boolean("verified").notNull().default(false),
    /** 'pending' | 'published' | 'rejected'. */
    status: text("status").notNull().default("pending"),
    /** Herkomst: 'native' (eigen) of 'judgeme' (geïmporteerd). */
    source: text("source").notNull().default("native"),
    /** Bron-id voor idempotente import (bv. "judgeme:123"). */
    externalId: text("external_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reviews_handle_status_idx").on(t.productHandle, t.status),
    index("reviews_status_idx").on(t.status, t.createdAt),
    index("reviews_order_idx").on(t.orderNumber),
    index("reviews_external_idx").on(t.externalId),
  ]
);

/* ─────────────────────────── Cadeaubonnen ──────────────────────────────── */

/**
 * Cadeaubonnen (giftcards) — SALDO-gebaseerd betaalmiddel, los van vouchers
 * (die zijn korting). Een bon wordt gekocht (pending → na betaling active +
 * gemaild), heeft een saldo dat bij gebruik wordt afgeboekt (meerdere keren
 * mogelijk) en een transactie-ledger voor audit + idempotentie. NL-prepaid:
 * optionele vervaldatum (ruim, instelbaar via settings.giftcardConfig).
 */
export const giftcards = pgTable(
  "giftcards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    initialCents: integer("initial_cents").notNull(),
    balanceCents: integer("balance_cents").notNull().default(0),
    /** 'pending' (betaling loopt) | 'active' | 'depleted' | 'cancelled'. */
    status: text("status").notNull().default("pending"),
    recipientName: text("recipient_name").notNull().default(""),
    recipientEmail: text("recipient_email").notNull().default(""),
    senderName: text("sender_name").notNull().default(""),
    message: text("message").notNull().default(""),
    buyerEmail: text("buyer_email").notNull().default(""),
    /** Koper-account (optioneel) — voor weergave in 'Mijn GENTS'. */
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Mollie-betaling van de aankoop (webhook-routing + idempotente activatie). */
    molliePaymentId: text("mollie_payment_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Geactiveerd + verstuurd (idempotentie-claim). */
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("giftcards_code_unique").on(t.code),
    index("giftcards_mollie_idx").on(t.molliePaymentId),
    index("giftcards_recipient_idx").on(t.recipientEmail),
    index("giftcards_customer_idx").on(t.customerId),
  ]
);

/** Saldo-mutaties per cadeaubon: + uitgifte/vrijgave, − besteding. Audit + idempotentie. */
export const giftcardTransactions = pgTable(
  "giftcard_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    giftcardId: uuid("giftcard_id")
      .notNull()
      .references(() => giftcards.id, { onDelete: "cascade" }),
    deltaCents: integer("delta_cents").notNull(),
    /** 'issue' | 'redeem' | 'release'. */
    reason: text("reason").notNull().default(""),
    /** Gekoppelde order (besteding/vrijgave) — idempotentiesleutel. */
    orderNumber: text("order_number").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("giftcard_tx_card_idx").on(t.giftcardId),
    index("giftcard_tx_order_idx").on(t.orderNumber),
  ]
);

/* ─────────────────────────── Nieuwsbrief ───────────────────────────────── */

/**
 * Nieuwsbrief-inschrijvingen — eigen store (bron van waarheid), met kanaalkeuze
 * e-mail óf WhatsApp. E-mail-opt-ins worden óók naar de Resend-audience gepusht;
 * WhatsApp-opt-ins (telefoon) alleen hier (geen Resend-equivalent). AVG: alleen
 * bij expliciete opt-in; uitschrijven via status.
 */
export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 'email' | 'whatsapp'. */
    channel: text("channel").notNull().default("email"),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    /** 'subscribed' | 'unsubscribed'. */
    status: text("status").notNull().default("subscribed"),
    /** Herkomst: 'site' | 'checkout' | 'popup'. */
    source: text("source").notNull().default("site"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("newsletter_email_idx").on(t.email),
    index("newsletter_phone_idx").on(t.phone),
    index("newsletter_channel_idx").on(t.channel),
  ]
);

/**
 * Retouren — klant start een retour vanuit z'n bestelling. Methode: DHL-retourlabel
 * of in de winkel inleveren. Vergoeding: geld terug (Mollie-refund) of store credit
 * (cadeaubon). Store credit / omruilen = gratis retour; geld terug kan retourkosten
 * hebben (instelbaar). Statussen: requested → label_created → received → completed.
 */
export const returns = pgTable(
  "returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    orderNumber: text("order_number").notNull(),
    email: text("email").notNull(),
    status: text("status").notNull().default("requested"),
    method: text("method").notNull(), // 'dhl' | 'store'
    refundType: text("refund_type").notNull(), // 'money' | 'credit'
    pickupStore: text("pickup_store").notNull().default(""), // bij method='store'
    reason: text("reason").notNull().default(""),
    itemsCents: integer("items_cents").notNull().default(0), // waarde geretourneerde items
    shippingCostCents: integer("shipping_cost_cents").notNull().default(0), // retourkosten (0 = gratis)
    refundedCents: integer("refunded_cents").notNull().default(0),
    creditCode: text("credit_code").notNull().default(""), // store-credit cadeaubon-code
    dhlLabelUrl: text("dhl_label_url").notNull().default(""),
    dhlTracking: text("dhl_tracking").notNull().default(""),
    // Voorraadcorrectie: gezet zodra supply chain de geretourneerde stuks fysiek
    // terug in SRS heeft geboekt. Null = staat nog op de "terug te scannen"-worklist.
    stockCorrectedAt: timestamp("stock_corrected_at", { withTimezone: true }),
    stockCorrectedBy: text("stock_corrected_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("returns_order_idx").on(t.orderId),
    index("returns_ordernr_idx").on(t.orderNumber),
    index("returns_email_idx").on(t.email),
    index("returns_status_idx").on(t.status),
    index("returns_stockcorr_idx").on(t.stockCorrectedAt),
  ],
);

export const returnLines = pgTable(
  "return_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    returnId: uuid("return_id").notNull(),
    orderLineId: uuid("order_line_id"),
    sku: text("sku").notNull().default(""),
    title: text("title").notNull().default(""),
    size: text("size").notNull().default(""),
    color: text("color").notNull().default(""),
    qty: integer("qty").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    reason: text("reason").notNull().default(""),
  },
  (t) => [index("return_lines_return_idx").on(t.returnId)],
);

/**
 * "Niet leverbaar"-meldingen per winkel — een weborder-regel die een winkel niet
 * fysiek kon leveren. Bron voor de her-allocatie-afhandeling én het
 * betrouwbaarheidssignaal (miss-rate per winkel).
 */
export const fulfillmentMisses = pgTable(
  "fulfillment_misses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    orderNumber: text("order_number").notNull(),
    store: text("store").notNull(),
    sku: text("sku").notNull().default(""),
    qty: integer("qty").notNull().default(1),
    reason: text("reason").notNull().default(""),
    outcome: text("outcome").notNull().default(""), // rerouted | unresolved
    reroutedTo: text("rerouted_to").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fmiss_store_idx").on(t.store),
    index("fmiss_order_idx").on(t.orderNumber),
    index("fmiss_created_idx").on(t.createdAt),
  ],
);

/**
 * Inventarisatie (telsessie) op de handscanner: scan artikelen, tel ze, en zet de
 * telling af tegen de systeemvoorraad → variantie → optioneel als voorraad-
 * correctie (core-movement) geboekt. type 'partial' + section = deelinventarisatie.
 */
export const inventorySessions = pgTable(
  "inventory_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    location: text("location").notNull(), // "GENTS Amersfoort"
    status: text("status").notNull().default("open"), // prepared | open | completed | applied | abandoned
    type: text("type").notNull().default("full"), // full | partial
    section: text("section").notNull().default(""), // bij partial: bv "Pakken", "Schoenen"
    /** Supply-chain klaargezet: scope = all | group | articles | section. */
    scope: text("scope").notNull().default(""),
    /** Bij group/articles/section: de gekozen groepen / artikelcodes / sectie-label. */
    scopeValues: jsonb("scope_values").notNull().default([]),
    /** Verwachte SKU's in scope (op klaarzet-moment) → voor de zeroing van
     *  niet-getelde artikelen: [{ sku, expected, title?, size?, color?, imageUrl? }]. */
    scopeSkus: jsonb("scope_skus").notNull().default([]),
    assignedBy: text("assigned_by").notNull().default(""), // supply-chain die 'm klaarzette
    note: text("note").notNull().default(""),
    startedBy: text("started_by").notNull().default(""),
    completedBy: text("completed_by").notNull().default(""),
    approvedBy: text("approved_by").notNull().default(""), // supply-chain die de varianties goedkeurde
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (t) => [index("inv_sessions_loc_idx").on(t.location, t.status), index("inv_sessions_created_idx").on(t.createdAt)],
);

export const inventoryCounts = pgTable(
  "inventory_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => inventorySessions.id, { onDelete: "cascade" }),
    stockKey: text("stock_key").notNull(), // lower(barcode) of lower(sku) — tel-sleutel
    sku: text("sku").notNull().default(""),
    barcode: text("barcode").notNull().default(""),
    title: text("title").notNull().default(""),
    size: text("size").notNull().default(""),
    color: text("color").notNull().default(""),
    imageUrl: text("image_url").notNull().default(""),
    scannedQty: integer("scanned_qty").notNull().default(0),
    expectedQty: integer("expected_qty").notNull().default(0), // systeemvoorraad bij eerste scan
    firstScannedAt: timestamp("first_scanned_at", { withTimezone: true }).notNull().defaultNow(),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inv_counts_session_key_unique").on(t.sessionId, t.stockKey),
    index("inv_counts_session_idx").on(t.sessionId),
  ],
);

/**
 * Reserveringen — gents.nl-native (SRS is alleen WMS, klanten leven in gents.nl).
 * De winkel/scanner houdt een artikel apart voor een gents.nl-klant. De voorraad
 * wordt HARD vastgehouden via het anti-oversell-primitief (web_stock_holds, ref
 * "RES-<id>", 7-daagse TTL) — niemand anders verkoopt het stuk. Géén SRS-push.
 * Rekent de klant online af → status 'converted' + de hold gaat over naar een
 * betaalde afhaalorder. Verloopt na validUntil → status 'expired' (hold valt vrij).
 */
export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    location: text("location").notNull(), // winkel waar 't apart ligt
    customerId: text("customer_id").notNull().default(""), // gents.nl-klant UUID (optioneel)
    customerEmail: text("customer_email").notNull().default(""),
    customerName: text("customer_name").notNull().default(""),
    customerPhone: text("customer_phone").notNull().default(""),
    status: text("status").notNull().default("open"), // open | picked_up | expired | cancelled | converted
    reason: text("reason").notNull().default(""), // klant_apart | klant_komt | apart_hangen
    note: text("note").notNull().default(""),
    // [{ stockKey, sku, barcode, title, size, color, imageUrl, qty, priceCents }]
    lines: jsonb("lines").notNull().default([]),
    validUntil: timestamp("valid_until", { withTimezone: true }), // null = onbeperkt (afgerekend)
    paid: boolean("paid").notNull().default(false),
    payToken: text("pay_token").notNull().default(""), // voor de online-afreken-link
    convertedOrderId: text("converted_order_id").notNull().default(""),
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reservations_loc_status_idx").on(t.location, t.status),
    index("reservations_customer_idx").on(t.customerId),
    index("reservations_paytoken_idx").on(t.payToken),
  ],
);

/**
 * Paspop / etalage — display-markering (NIET-blokkerend). Een stuk op de paspop
 * blijft gewoon verkoopbaar (we raken de voorraad-availability niet aan); het is
 * puur zichtbaarheid ("wat hangt er in de winkel") + telt mee bij inventarisatie
 * (de teller ziet 't, de zeroing boekt 't niet weg). Eén rij per (winkel, stockKey),
 * qty = aantal stuks op de poppen.
 */
export const displayItems = pgTable(
  "display_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    location: text("location").notNull(),
    stockKey: text("stock_key").notNull(), // lower(barcode||sku)
    sku: text("sku").notNull().default(""),
    barcode: text("barcode").notNull().default(""),
    title: text("title").notNull().default(""),
    size: text("size").notNull().default(""),
    color: text("color").notNull().default(""),
    imageUrl: text("image_url").notNull().default(""),
    qty: integer("qty").notNull().default(1),
    note: text("note").notNull().default(""), // bv. "etalage links", "paspop 2"
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("display_loc_key_unique").on(t.location, t.stockKey), index("display_loc_idx").on(t.location)],
);

/**
 * Kassa-verkopen (POS) — de bron-van-waarheid voor retail-verkoop in de Neon-core.
 * Vervangt de storegents-blob `admin/pos-sales.json` (last-writer-wins). Fase 1: een
 * getrouwe mirror — queryable kolommen + de volledige verkoop als JSONB `data`
 * (euro's, lines/payments/korting/loyalty/SRS-velden), zodat de bestaande
 * storegents-rekenlogica ongewijzigd blijft. Idempotent op client_ref (offline sync).
 */
export const posSales = pgTable(
  "pos_sales",
  {
    id: text("id").primaryKey(), // pos-<...> id van de kassa
    clientRef: text("client_ref").notNull().default(""), // idempotentie offline-sync
    store: text("store").notNull(),
    cashier: text("cashier").notNull().default(""),
    cashierId: text("cashier_id").notNull().default(""),
    customerId: text("customer_id").notNull().default(""),
    totalCents: integer("total_cents").notNull().default(0),
    itemCount: integer("item_count").notNull().default(0),
    cancelled: boolean("cancelled").notNull().default(false),
    srsPosted: boolean("srs_posted").notNull().default(false),
    data: jsonb("data").notNull(), // de volledige verkoop (zoals de kassa 'm bouwt)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pos_sales_clientref_unique").on(t.clientRef).where(sql`${t.clientRef} <> ''`),
    index("pos_sales_store_created_idx").on(t.store, t.createdAt),
    index("pos_sales_store_flags_idx").on(t.store, t.cancelled, t.srsPosted),
  ],
);

/**
 * Kassa-dagafsluitingen (Z + kasopmaak) — bron-van-waarheid in de Neon-core.
 * Vervangt de storegents-blob admin/kassa-closings.json. De blob had geen atomaire
 * read-modify-write, waardoor een tweede schrijver (bv. de mail-status) een zojuist
 * vastgelegde afsluiting kon overschrijven. Unieke (store, date) → atomaire upsert,
 * dus die klasse race-bugs is hier onmogelijk.
 */
export const posClosings = pgTable(
  "pos_closings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    store: text("store").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD (Europa/Amsterdam)
    dagstaat: jsonb("dagstaat").notNull(),
    kasopmaak: jsonb("kasopmaak").notNull(),
    note: text("note").notNull().default(""),
    actor: jsonb("actor").notNull().default({}),
    mailedAt: timestamp("mailed_at", { withTimezone: true }),
    mailStatus: text("mail_status").notNull().default(""),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pos_closings_store_date_unique").on(t.store, t.date),
    index("pos_closings_store_date_idx").on(t.store, t.date),
  ],
);

/**
 * Inbound goederenontvangst — een zending naar een winkel (replenishment vanuit
 * het magazijn, leverancier-levering of winkel→winkel-herverdeling). DE ASN: wat
 * verwacht wordt + de status (gepickt → onderweg → ontvangen). Gespiegeld op
 * inventorySessions. KERN-REGEL: voorraad ontstaat PAS bij de scan-ontvangst (een
 * channel:'inbound' +1-movement, ref `RCV-<id>`); onderweg-voorraad telt NIET mee
 * in `available` (anti-fantoomvoorraad — niets verkoopbaar zolang 't onderweg is).
 */
export const inboundShipments = pgTable(
  "inbound_shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull().default(""), // "magazijn" of leverancier-naam
    sourceType: text("source_type").notNull().default("transfer"), // transfer | supplier | interstore
    fromLocation: text("from_location").notNull().default(""), // bronwinkel bij herverdeling
    toStore: text("to_store").notNull(), // ontvangende winkel
    status: text("status").notNull().default("picked"), // picked | in_transit | receiving | received | closed | cancelled
    linkRef: text("link_ref").notNull().default(""), // MAG-YYYY-NNNN / srsOrderNr → traceability
    parts: integer("parts").notNull().default(1), // aantal dozen/colli
    // Verzendmethode bij winkel→winkel-herverdeling (F4+): 'route' (eigen rit) of 'dhl'.
    shipMethod: text("ship_method").notNull().default(""),
    plannedRouteDate: timestamp("planned_route_date", { withTimezone: true }), // geplande rit-datum bij 'route'
    urgent: boolean("urgent").notNull().default(false),
    // De ASN-regels: [{ stockKey, sku, barcode, title, size, color, imageUrl, expectedQty }]
    expectedLines: jsonb("expected_lines").notNull().default([]),
    // Bevroren steekproefplan (F2): { mode, sampledStockKeys, mandatoryStockKeys, n, ac, re, trustLevel, ... }
    samplePlan: jsonb("sample_plan"),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").notNull().default(""),
    pickedBy: text("picked_by").notNull().default(""),
    receivedBy: text("received_by").notNull().default(""), // winkelmedewerker die afsloot
    pickedAt: timestamp("picked_at", { withTimezone: true }),
    inTransitAt: timestamp("in_transit_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inbound_tostore_status_idx").on(t.toStore, t.status),
    index("inbound_source_idx").on(t.source),
    index("inbound_created_idx").on(t.createdAt),
    index("inbound_linkref_idx").on(t.linkRef),
  ],
);

/**
 * Per-SKU scanresultaat van een ontvangst (gespiegeld op inventoryCounts). Atomaire
 * upsert (scanned_qty += qty) zodat meerdere medewerkers tegelijk kunnen scannen.
 * variance = scannedQty − expectedQty (afgeleid). `blind` (F2-steekproef) verbergt
 * het verwachte aantal in de UI tot ná het tellen.
 */
export const inboundReceiptCounts = pgTable(
  "inbound_receipt_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id").notNull().references(() => inboundShipments.id, { onDelete: "cascade" }),
    stockKey: text("stock_key").notNull(), // lower(barcode||sku)
    sku: text("sku").notNull().default(""),
    barcode: text("barcode").notNull().default(""),
    title: text("title").notNull().default(""),
    size: text("size").notNull().default(""),
    color: text("color").notNull().default(""),
    imageUrl: text("image_url").notNull().default(""),
    expectedQty: integer("expected_qty").notNull().default(0), // uit de ASN
    scannedQty: integer("scanned_qty").notNull().default(0),
    blind: boolean("blind").notNull().default(false), // F2: steekproefregel → verwacht aantal verborgen
    // F3+ schade-melding: een deel van het gescande is beschadigd/verkeerd → niet als
    // verkoopbare voorraad boeken (quarantaine) + een afwijking met deze code.
    flagCode: text("flag_code").notNull().default(""), // DAMAGED | WRONG_ITEM | QUALITY | MISLABELED
    flagQty: integer("flag_qty").notNull().default(0),
    firstScannedAt: timestamp("first_scanned_at", { withTimezone: true }).notNull().defaultNow(),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inbound_counts_shipment_key_unique").on(t.shipmentId, t.stockKey),
    index("inbound_counts_shipment_idx").on(t.shipmentId),
  ],
);

/**
 * Afwijkingen bij goederenontvangst (F3) — de tegenhanger van fulfillment_misses,
 * maar dan inbound. Per regel die niet klopte: code (vaste taxonomie zodat het
 * dashboard erop filtert) + status-spoor (open → claim → afgehandeld). Voedt de
 * supply-chain-melding én het manco-profiel/dashboard (manco-rate per bron/winkel).
 */
export const receivingDiscrepancies = pgTable(
  "receiving_discrepancies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id").notNull().references(() => inboundShipments.id, { onDelete: "cascade" }),
    source: text("source").notNull().default(""), // bron/leverancier
    sourceType: text("source_type").notNull().default("transfer"),
    toStore: text("to_store").notNull().default(""),
    linkRef: text("link_ref").notNull().default(""),
    stockKey: text("stock_key").notNull().default(""),
    sku: text("sku").notNull().default(""),
    title: text("title").notNull().default(""),
    size: text("size").notNull().default(""),
    color: text("color").notNull().default(""),
    expectedQty: integer("expected_qty").notNull().default(0),
    scannedQty: integer("scanned_qty").notNull().default(0),
    variance: integer("variance").notNull().default(0), // scanned − expected
    code: text("code").notNull().default("SHORT"), // SHORT | OVER | DAMAGED | WRONG_ITEM | NOT_ORDERED | QUALITY | MISLABELED
    status: text("status").notNull().default("open"), // open | claim_filed | credited | written_off | resolved
    note: text("note").notNull().default(""),
    photoUrl: text("photo_url").notNull().default(""),
    resolvedBy: text("resolved_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("recdisc_source_idx").on(t.source, t.createdAt),
    index("recdisc_store_idx").on(t.toStore, t.createdAt),
    index("recdisc_code_idx").on(t.code),
    index("recdisc_status_idx").on(t.status),
    index("recdisc_shipment_idx").on(t.shipmentId),
    // Uniek per (zending, regel, code): twee gelijktijdige ontvangst-afrondingen loggen zo
    // geen dubbele afwijkingen (logDiscrepancies gebruikt onConflictDoNothing hierop).
    uniqueIndex("recdisc_uq").on(t.shipmentId, t.stockKey, t.code),
  ],
);
