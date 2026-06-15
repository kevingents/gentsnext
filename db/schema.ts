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
    /** 'standard' | 'express' (snellere levering tegen toeslag). */
    deliveryMethod: text("delivery_method").notNull().default("standard"),
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
    /** Beheerder — toegang tot de instellingen-backend. */
    isAdmin: boolean("is_admin").notNull().default(false),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("loyalty_events_customer_idx").on(t.customerId)]
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
