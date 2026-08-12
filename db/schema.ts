import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
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
     * SRS-eigen sleutel voor het PIM. Een product = artikelnummer + kleur (dat is wat
     * de klant als één product ziet, met een maatboog eronder); een variant daaronder
     * is een barcode. Vervangt shopify_product_id als identiteit zodra de SRS-import
     * de bron is — daarom additief aangelegd, niet als vervanging.
     */
    srsArtikelNummer: text("srs_artikel_nummer").notNull().default(""),
    srsKleurId: text("srs_kleur_id").notNull().default(""),
    /**
     * Welke velden zijn met de hand gezet en mogen door een SRS-import NIET
     * overschreven worden. Zonder deze scheiding wist elke import de verrijking —
     * precies wat eerder gebeurde toen her-import de onzin-omschrijvingen terugzette.
     */
    handmatigeVelden: jsonb("handmatige_velden").notNull().default([]),
    /** Laatste keer dat dit product in de SRS-feed voorkwam (verdwenen = opgeruimd?). */
    srsGezienOp: timestamp("srs_gezien_op", { withTimezone: true }),
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
    // Expressie-indexen op de hot JSON-attributen: de PLP filtert/facetteert per
    // hoofdgroep en de merkpagina's per merk. Zonder deze indexen seq-scant elke
    // PLP-query ~2900 producten (~15-19ms/query); met index → index-scan (~1-2ms).
    index("products_hoofdgroep_idx").on(sql`((attributes ->> 'hoofdgroep_omschrijving'))`),
    index("products_merk_idx").on(sql`((attributes ->> 'merk'))`),
    // Conflict-target van de komende SRS-import: een product is artikelnummer + kleur.
    // Partieel, want zolang de Shopify-import nog draait staan die kolommen leeg en
    // zou één unieke index op '' alle rijen laten botsen.
    uniqueIndex("products_srs_artikel_kleur_unique")
      .on(t.srsArtikelNummer, t.srsKleurId)
      .where(sql`${t.srsArtikelNummer} <> ''`),
  ]
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /**
     * DE join-sleutel naar de voorraad: srs_stock matcht hierop, nergens anders op.
     * Bij een SRS-gevoede catalogus is dit het SRS-barcodenummer (29000...).
     */
    sku: text("sku").notNull().default(""),
    /**
     * LET OP — dit veld heet 'barcode' maar bevat sinds de Shopify-import de EAN van
     * de LEVERANCIER, een heel ander nummer dan de SRS-code. Op productie: 16.514 van
     * de varianten hebben barcode ≠ sku, en dáárvan matcht er nul op srs_stock terwijl
     * 7.558 wél op sku matchen. Elke voorraad-lookup die 'barcode || sku' als sleutel
     * gebruikt, zoekt dus op een nummer dat de voorraadbron niet kent.
     * De leveranciers-EAN verhuist naar supplier_ean zodra de SRS-import draait.
     */
    barcode: text("barcode").notNull().default(""),
    /** EAN van de leverancier — informatief, NOOIT als voorraad-sleutel gebruiken. */
    supplierEan: text("supplier_ean").notNull().default(""),
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
    // '' = echte (gesyncte) foto; 'ai-packshot' = gegenereerd beeld ter indicatie.
    // AI-rijen overleven de Shopify-import en wijken zodra echte foto's binnenkomen.
    source: text("source").notNull().default(""),
    // true = deze foto is een packshot (alleen het product, egale achtergrond) i.p.v.
    // een modelfoto/sfeerbeeld. Gezet door de beeld-classificatie in storegents, via
    // /api/core/catalog/packshots. Wordt ALLEEN gebruikt om de kassa het artikel te
    // laten zien i.p.v. een model; `position` blijft de redactionele volgorde en
    // bepaalt onveranderd wat gents.nl toont.
    isPackshot: boolean("is_packshot").notNull().default(false),
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
    /** Taal waarin de klant besteld heeft (nl|en|de|fr|es) — de bevestigings- én
     *  statusmails gaan in DEZE taal. Waarom op de order en niet meegegeven vanaf
     *  de checkout: de bevestiging vertrekt vanuit de betaal-webhook en de
     *  statusmails uit het back-office, dagen later; die kennen alléén de order.
     *  Zelfde patroon als appointments.locale. */
    locale: text("locale").notNull().default("nl"),
    /** Zakelijk bestellen (optioneel): bedrijfsnaam + BTW-nummer. */
    companyName: text("company_name").notNull().default(""),
    vatNumber: text("vat_number").notNull().default(""),
    /** 'standard' | 'express' (snellere levering tegen toeslag) | 'pickup' (afhalen in winkel). */
    deliveryMethod: text("delivery_method").notNull().default("standard"),
    /** Bij 'pickup': de winkel waar de klant afhaalt (winkelnaam, bv. "GENTS Groningen"). */
    pickupStore: text("pickup_store").notNull().default(""),
    /** Verkopende winkel bij een kassa-bestelling (endless aisle): de order wordt uit een ander
     *  filiaal/magazijn geleverd, maar de OMZET hoort bij de winkel die 'm verkocht. '' = webshop. */
    soldByStore: text("sold_by_store").notNull().default(""),
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
    /** Wélke methode de klant koos (ideal, creditcard, klarna, bancontact, …).
     *  Stond nergens vast: `paymentStatus` is alleen 'paid'. Het is een sterk
     *  profielkenmerk én het stuurt de volgorde van de betaalkeuze in de
     *  checkout. Leeg voor de historische import — eerlijker dan een gok. */
    betaalmethode: text("betaalmethode").notNull().default(""),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** SRS-weborder-push-status (na betaling) — voor de latere koppeling. */
    srsPushedAt: timestamp("srs_pushed_at", { withTimezone: true }),
    /** Allocatieplan (welke filialen leveren wat) — lib/fulfillment. */
    fulfillmentPlan: jsonb("fulfillment_plan"),
    /** 'pending' | 'planned' | 'pushed' | 'partial' | 'failed'. */
    fulfillmentStatus: text("fulfillment_status").notNull().default("pending"),
    /** Orderbevestigingsmail verstuurd (idempotent — webhook kan dubbel komen). */
    confirmationSentAt: timestamp("confirmation_sent_at", { withTimezone: true }),
    /** De aanraking die déze order opleverde, vastgevroren bij het bestellen:
     *  {source, medium, campaign, gclid, fbclid, …}. Bewust een kopie en geen
     *  verwijzing naar visitorAttribution — die beweegt mee met het volgende
     *  bezoek, terwijl een order toegerekend moet blijven aan de campagne die
     *  'm bracht. Voedt ook de server-side conversie naar Google/Meta. */
    attributie: jsonb("attributie").notNull().default({}),
    /** Het device (gents-sid) waarop besteld is — koppelt de order aan het
     *  gedrag ervoor (welke producten bekeken, welke zoekopdracht). */
    sessionId: text("session_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_order_number_unique").on(t.orderNumber),
    uniqueIndex("orders_mollie_payment_unique").on(t.molliePaymentId),
    index("orders_status_idx").on(t.status),
    // Ingelogde-klant-paden (account-orders, taste-sort, login-claim) + gast-koppeling
    // op e-mail — voorheen een seq-scan over álle orders.
    index("orders_customer_id_idx").on(t.customerId),
    index("orders_email_idx").on(t.email),
  ]
);

/**
 * Completeness-gate voor split-orders (lib/split-fulfilment). Bij een order die
 * uit meerdere WINKELS geleverd wordt, legt elke winkel vast dat zijn deel gepickt/
 * gereed is. Pas als álle winkel-delen gereed zijn mag er een verzendlabel komen
 * (order-docs blokkeert anders) — voorkomt een half-verscheepte order. Eén rij per
 * (ordernummer, genormaliseerde winkelnaam); afwezige rij = nog niet gereed.
 */
export const orderShipmentPicks = pgTable(
  "order_shipment_picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderNumber: text("order_number").notNull(),
    shipmentKey: text("shipment_key").notNull(), // lower(store)
    store: text("store").notNull().default(""), // weergavenaam
    pickedBy: text("picked_by").notNull().default(""),
    pickedAt: timestamp("picked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("order_shipment_picks_uq").on(t.orderNumber, t.shipmentKey),
    index("order_shipment_picks_order_idx").on(t.orderNumber),
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
    /** Bekende klant achter dit event; NULL zolang het device anoniem is. Wordt
     *  óók met terugwerkende kracht ingevuld zodra een device bekend wordt
     *  (lib/identity: koppelDevice), want de eerste sessie is meestal de sessie
     *  waarin de klant zich oriënteerde — juist die wil je in het profiel. */
    customerId: uuid("customer_id"),
    /** 'web' | 'pos' | 'server' | 'app' — anders vallen kassa- en webevents in
     *  dezelfde emmer en klopt elke funnel-telling niet meer. */
    bron: text("bron").notNull().default("web"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_type_time_idx").on(t.type, t.createdAt),
    index("events_handle_idx").on(t.handle),
    index("events_query_idx").on(t.query),
    index("events_session_idx").on(t.sessionId),
    index("events_klant_time_idx").on(t.customerId, t.createdAt),
    index("events_session_time_idx").on(t.sessionId, t.createdAt),
  ]
);

/**
 * Eerste én laatste aanraking per device (het anonieme gents-sid).
 *
 * Attributie hoort bij het DEVICE, niet bij elk los event — daarom een aparte
 * tabel in plaats van nog vijftien kolommen op `events` (die tabel groeit het
 * hardst en moet smal blijven). De klik-id's zijn wat Google en Meta nodig
 * hebben om een server-side of offline conversie aan de juiste advertentieklik
 * te hangen; die werden tot nu toe nergens bewaard, waardoor élke conversie
 * ongeattribueerd was.
 */
export const visitorAttribution = pgTable(
  "visitor_attribution",
  {
    sessionId: text("session_id").primaryKey(),
    firstSource: text("first_source").notNull().default(""),
    firstMedium: text("first_medium").notNull().default(""),
    firstCampaign: text("first_campaign").notNull().default(""),
    firstTerm: text("first_term").notNull().default(""),
    firstContent: text("first_content").notNull().default(""),
    firstReferrer: text("first_referrer").notNull().default(""),
    firstLanding: text("first_landing").notNull().default(""),
    lastSource: text("last_source").notNull().default(""),
    lastMedium: text("last_medium").notNull().default(""),
    lastCampaign: text("last_campaign").notNull().default(""),
    gclid: text("gclid").notNull().default(""),
    gbraid: text("gbraid").notNull().default(""),
    wbraid: text("wbraid").notNull().default(""),
    fbclid: text("fbclid").notNull().default(""),
    ttclid: text("ttclid").notNull().default(""),
    msclkid: text("msclkid").notNull().default(""),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("visitor_attribution_bron_idx").on(t.firstSource, t.firstMedium)]
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
    /**
     * WAT de code verzilverde: het ordernummer, of aan de kassa de bon-referentie.
     * Nodig voor idempotentie buiten de webshop: een kassa-POST kan opnieuw komen
     * (netwerk, offline-sync), en zonder deze referentie is "al verzilverd" niet te
     * onderscheiden van "door mijzelf verzilverd" — de kassier zou een geldige
     * tegoedbon geweigerd zien, of 'm twee keer aftrekken.
     */
    redeemedRef: text("redeemed_ref").notNull().default(""),
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
 * Apple-Wallet pas-registraties (PassKit web service). Een iPhone die de
 * spaarpas toevoegt registreert zich hier met z'n pushToken; als het saldo
 * verandert sturen we een APNs-push naar die devices zodat de pas zichzelf
 * ververst. serialNumber = customerId (= de pas-serial). PK op (device, serial)
 * zodat één device zich niet dubbel registreert voor dezelfde pas.
 */
export const walletAppleRegistrations = pgTable(
  "wallet_apple_registrations",
  {
    deviceLibraryIdentifier: text("device_library_identifier").notNull(),
    serialNumber: text("serial_number").notNull(),
    pushToken: text("push_token").notNull(),
    /**
     * Het saldo zoals de pas het kent na de laatste geslaagde push. Maakt drift
     * zichtbaar: wijkt dit af van het huidige saldo, dan loopt de pas achter en
     * moet er alsnog gepusht worden. Zonder deze kolom is een gemiste push
     * onzichtbaar — er komt geen fout, de klant ziet alleen een oud getal.
     * NULL = nog nooit gepusht.
     */
    lastPushedPoints: integer("last_pushed_points"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceLibraryIdentifier, t.serialNumber] }),
    index("wallet_apple_reg_serial_idx").on(t.serialNumber),
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
    // Harde idempotentie-grens: precies één mutatie per (bon, referentie, soort). Onder
    // neon-http (geen transacties) is dit de enige echte serialisatie — twee gelijktijdige
    // redeems/releases/activaties met dezelfde ref botsen hier i.p.v. dubbel te boeken.
    uniqueIndex("giftcard_tx_ref_reason_unique").on(t.giftcardId, t.orderNumber, t.reason),
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
 * Kasmutaties (IN/UIT KAS, IN/UIT KLUIS tijdens de dag) — bron-van-waarheid in de
 * Neon-core. Vervangt de storegents-blob admin/pos-kas-mutaties.json. Dit is een
 * GELDSPOOR: append-only (fout = tegenmutatie boeken, geen bewerken/wissen) en
 * zonder de 2000-records-cap van de blob — kasadministratie knip je niet af.
 * Zelfde mirror-opzet als pos_sales: queryable kolommen + het volledige record
 * als jsonb `data`; idempotent op id (retry/backfill boekt nooit dubbel).
 */
export const posKasMutaties = pgTable(
  "pos_kas_mutaties",
  {
    id: text("id").primaryKey(), // km-<...> id van de kassa
    store: text("store").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD (Europa/Amsterdam)
    type: text("type").notNull(), // inkas | uitkas | kluis-in | kluis-uit
    amountCents: integer("amount_cents").notNull().default(0),
    data: jsonb("data").notNull(), // de volledige mutatie (incl. reason + actor)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pos_kas_mutaties_store_date_idx").on(t.store, t.date)],
);

/**
 * Kas-openingen (beginkas/wisselgeld-telling per winkel per dag) — bron-van-waarheid
 * in de Neon-core. Vervangt de storegents-blob admin/kassa-openings.json. Unieke
 * (store, date) → één telling per dag; een hertelling overschrijft mét audit-spoor
 * (`previous` in de data-jsonb). De SRS-claim (data->'srs') wordt hier ATOMAIR gezet
 * (één conditionele update) — de blob-claim had een read-modify-write-venster waarin
 * twee gelijktijdige tellingen allebei konden boeken.
 */
export const posOpenings = pgTable(
  "pos_openings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    store: text("store").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD (Europa/Amsterdam)
    amountCents: integer("amount_cents").notNull().default(0),
    data: jsonb("data").notNull(), // de volledige opening (coupures/actor/previous/srs)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pos_openings_store_date_unique").on(t.store, t.date)],
);

/**
 * Geparkeerde kassa-mandjes (held sales / drafts) — bron-van-waarheid in de
 * Neon-core. Vervangt de storegents-blob admin/pos-sales-drafts.json. Een concept
 * boekt niets (geen voorraad/loyalty); zichtbaar over devices/locaties omdat de
 * opslag centraal is. Upsert op id (het draft-id van de kassa).
 */
export const posDrafts = pgTable(
  "pos_drafts",
  {
    id: text("id").primaryKey(), // draft-<...> id van de kassa
    store: text("store").notNull(),
    data: jsonb("data").notNull(), // het volledige concept (lines/klant/label/…)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pos_drafts_store_updated_idx").on(t.store, t.updatedAt)],
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
 * Klantafspraken (trouwconsult voorop) — de klant vraagt online een afspraak in
 * een winkel aan; de winkel (kassa/portal) leest en beheert ze via de core-API.
 * Bewust een DAGDEEL i.p.v. een exact tijdslot: de winkel belt/mailt zelf het
 * definitieve tijdstip (MVP zonder agenda-koppeling), dus geen
 * dubbele-boeking-logica nodig.
 */
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 'trouwconsult' | 'pasafspraak' | 'personal-shopping' */
    type: text("type").notNull().default("trouwconsult"),
    /** Winkelnaam zoals in content/stores.json ("GENTS Amsterdam") — de brug naar kassa/portal. */
    store: text("store").notNull(),
    preferredDate: date("preferred_date").notNull(),
    /** 'ochtend' | 'middag' | 'avond' | 'geen-voorkeur' */
    dagdeel: text("dagdeel").notNull().default("geen-voorkeur"),
    /** Het afgesproken tijdstip ("14:30"), gezet zodra de winkel bevestigt.
     *  Leeg zolang alleen het dagdeel bekend is (de online aanvraag). */
    tijd: text("tijd").notNull().default(""),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    /** Vrije wensen van de klant: trouwdatum, gezelschap, kleurwensen, … */
    wensen: text("wensen").notNull().default(""),
    /** Taal van de aanvraag — voor eventuele vervolgcommunicatie in de juiste taal. */
    locale: text("locale").notNull().default("nl"),
    /** 'nieuw' | 'bevestigd' | 'afgerond' | 'no-show' | 'geannuleerd' */
    status: text("status").notNull().default("nieuw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // De kassa vraagt per winkel een datumvenster op — dit is dé leesquery.
    index("appointments_store_date_idx").on(t.store, t.preferredDate),
    index("appointments_status_idx").on(t.status),
  ]
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

/**
 * Portal-gebruik: wie opent welke portal-pagina, hoe vaak.
 *
 * De portal heeft 196 pagina's en tot nu toe géén enkele meting — "dit gebruiken
 * we niet" was daardoor altijd een gevoel. Voor het opschonen rond de SRS-exit is
 * dat te weinig: één verkeerd weggegooid scherm is een afdeling die vastloopt.
 *
 * Bewust GEAGGREGEERD per dag i.p.v. een regel per klik: dat houdt de tabel klein
 * (196 pagina's × ~40 medewerkers × 1 rij/dag) en is precies genoeg om "wordt dit
 * nog gebruikt, en door wie" te beantwoorden. Geen IP, geen user-agent, geen
 * query-parameters — alleen het pad.
 */
export const portalUsage = pgTable(
  "portal_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Kalenderdag (UTC) — samen met pad + gebruiker de unieke sleutel. */
    dag: date("dag").notNull(),
    /** Route zonder query, bv. "/voorraad-drift". */
    pad: text("pad").notNull(),
    /** SRS personnelId of office userId. Leeg bij kiosk-sessies. */
    gebruikerId: text("gebruiker_id").notNull().default(""),
    gebruikerNaam: text("gebruiker_naam").notNull().default(""),
    /** 'personnel' | 'office' | 'kiosk' — onderscheidt winkel van kantoor. */
    soort: text("soort").notNull().default(""),
    /** Winkel/afdeling waaronder de gebruiker werkte, voor "welke winkel mist dit". */
    winkel: text("winkel").notNull().default(""),
    aantal: integer("aantal").notNull().default(1),
    laatstOp: timestamp("laatst_op", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Eén rij per gebruiker per pagina per dag; de teller loopt op via upsert.
    uniqueIndex("portal_usage_uq").on(t.dag, t.pad, t.gebruikerId),
    index("portal_usage_pad_idx").on(t.pad),
    index("portal_usage_dag_idx").on(t.dag),
  ],
);

/* ── Students-acties (verenigingskorting aan de kassa) ────────────────────────
 *
 * Kevin/Remy, 6 aug: Remy maakt in de portal een actie, hangt er een vereniging
 * en één of alle winkels aan, kiest welke producten meedoen (of alles) en een
 * kortingspercentage. De winkel klikt de actie aan de kassa aan, scant, en alleen
 * de deelnemende producten krijgen korting. Een klant is verplicht — die wordt
 * aan de vereniging gekoppeld, zodat Remy per vereniging ziet wie wat kocht.
 *
 * Waarom in Neon en niet als blob-config: hier hangen VERKOOPCIJFERS aan (Remy
 * moet erop kunnen rapporteren) en de kassa moet de actielijst per winkel snel
 * en betrouwbaar kunnen ophalen.
 */
export const studentActies = pgTable(
  "student_acties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    naam: text("naam").notNull(),
    /** Studentenvereniging waarvoor de actie geldt. */
    vereniging: text("vereniging").notNull(),
    /** Lege lijst = ALLE winkels; anders exact deze winkelnamen. */
    winkels: jsonb("winkels").notNull().default([]),
    /** Lege lijst = ALLE producten; anders deze sku's/barcodes. */
    producten: jsonb("producten").notNull().default([]),
    /** Kortingspercentage (0-100) op de deelnemende regels. */
    kortingPct: integer("korting_pct").notNull().default(0),
    /** Geldigheid; leeg = geen begrenzing aan die kant. */
    vanaf: date("vanaf"),
    tot: date("tot"),
    actief: boolean("actief").notNull().default(true),
    aangemaaktDoor: text("aangemaakt_door").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("student_acties_actief_idx").on(t.actief),
    index("student_acties_vereniging_idx").on(t.vereniging),
  ],
);

/** Eén rij per kassabon die onder een actie is afgerekend — de bron voor Remy's overzicht. */
export const studentActieVerkopen = pgTable(
  "student_actie_verkopen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actieId: uuid("actie_id").notNull(),
    /** Snapshot: een actie kan later hernoemd worden, de historie moet kloppen. */
    actieNaam: text("actie_naam").notNull().default(""),
    vereniging: text("vereniging").notNull().default(""),
    store: text("store").notNull(),
    /** Kassabon waar dit bij hoort (pos_sales.id) — idempotentie-sleutel. */
    saleId: text("sale_id").notNull().default(""),
    klantNaam: text("klant_naam").notNull().default(""),
    klantEmail: text("klant_email").notNull().default(""),
    klantId: text("klant_id").notNull().default(""),
    /** Regels mét korting: [{ sku, title, qty, priceCent, kortingCent }]. */
    regels: jsonb("regels").notNull().default([]),
    kortingCent: integer("korting_cent").notNull().default(0),
    omzetCent: integer("omzet_cent").notNull().default(0),
    kassier: text("kassier").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Eén registratie per bon: een herhaalde melding mag niet dubbel tellen.
    uniqueIndex("student_verkopen_sale_uq").on(t.saleId),
    index("student_verkopen_actie_idx").on(t.actieId),
    index("student_verkopen_vereniging_idx").on(t.vereniging),
  ],
);

/** Klant ↔ vereniging: wie hoort bij welke vereniging (Kevin: "deze klant is dan
 *  ook gekoppeld aan de vereniging"). Sleutel is het e-mailadres — dat heeft elke
 *  kassaklant, een klantnummer niet altijd. */
export const studentLeden = pgTable(
  "student_leden",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    klantEmail: text("klant_email").notNull(),
    klantNaam: text("klant_naam").notNull().default(""),
    klantId: text("klant_id").notNull().default(""),
    vereniging: text("vereniging").notNull(),
    /** Waar de koppeling vandaan komt (eerste actie waarin de klant meedeed). */
    bronActieId: uuid("bron_actie_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("student_leden_email_uq").on(t.klantEmail),
    index("student_leden_vereniging_idx").on(t.vereniging),
  ],
);

/* ── Exact Online-koppelingsstatus (verhuisd uit Vercel Blob, aug 2026) ────────
   Kleine key/value-tabel: de versleutelde OAuth-tokens (storegents versleutelt
   vóór het schrijven — de database ziet nooit een leesbare token), de
   boekhoud-mapping en de geboekt-markers. Waarom Postgres i.p.v. blob: blob is
   uiteindelijk-consistent en kent geen sloten, en Exacts refresh-token is
   eenmalig — twee servers die tegelijk verversen kostte op 11-8-2026 de hele
   koppeling ("Old refresh token used"). Hier is lezen altijd vers en is de
   refresh-claim één atomaire statement. */
export const exactState = pgTable("exact_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Loyalty-core: kassa-spaarpunten (verhuisd uit Vercel Blob, aug 2026) ──────
   Vervangt de storegents-blob admin/loyalty-core.json (saldo + mutaties per
   klant, MAX 500 mutaties → historie werd afgekapt; mutateJsonBlob = last-
   writer-wins → gelijktijdige boekingen konden elkaar overschrijven). Dit is de
   belangrijkste GELD-store van de kassa: hier telt élke mutatie.

   Sleutel = het kassa-klant-id zoals storegents het aanlevert (TEXT): meestal
   het numerieke SRS-klantnummer, soms een gents.nl-klant-uuid. Bewust GEEN FK
   naar `customers` — de kassa kent klanten die (nog) geen gents.nl-account
   hebben; unificatie kan later via customers.srsCustomerId. Dit grootboek staat
   dus NAAST loyaltyEvents (dat is het gents.nl-web-spaarprogramma op
   customers.id); samenvoegen is een aparte stap.

   Saldo-consistentie: het saldo staat gematerialiseerd op loyalty_accounts en
   wordt SAMEN met de ledger-insert gemuteerd in ÉÉN data-modifying-CTE-statement
   (zie lib/loyalty-core.ts). Eén statement = één impliciete transactie, ook over
   de neon-http-driver (die kent geen multi-statement-transacties). De ledger is
   append-only (geen cap) en blijft de audit-bron; NB: saldo ≠ SUM(ledger) is
   mogelijk door de 0-vloer (blob-pariteit: saldo kan nooit negatief) en doordat
   de blob-backfill alleen de laatste ≤500 mutaties per klant heeft. */
export const loyaltyAccounts = pgTable(
  "loyalty_accounts",
  {
    /** Kassa-klant-id (SRS-klantnummer of gents.nl-uuid) — zoals storegents 'm aanlevert. */
    customerId: text("customer_id").primaryKey(),
    name: text("name").notNull().default(""),
    balance: integer("balance").notNull().default(0),
    /** Gezet zodra de blob-baseline voor dit account is bijgeteld — maakt de
     *  backfill idempotent én race-veilig (tweede backfill telt niet dubbel). */
    backfilledAt: timestamp("backfilled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

export const loyaltyMutations = pgTable(
  "loyalty_mutations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: text("customer_id").notNull(),
    /** Punten-delta: positief = verdiend, negatief = ingewisseld/retour/terugdraai. */
    delta: integer("delta").notNull(),
    reason: text("reason").notNull().default(""),
    /** Referentie naar de kassa-bon (sale-id); leeg bij handmatige correcties. */
    saleId: text("sale_id").notNull().default(""),
    store: text("store").notNull().default(""),
    actor: text("actor").notNull().default(""),
    /** Idempotentie-sleutel: met saleId = `<customerId>|<saleId>|<reason>` (zelfde
     *  dedup als de blob: één earn/inwissel/terugdraai per bon per reden); zonder
     *  saleId = het gegenereerde mutatie-id (correcties mogen altijd); backfill
     *  zonder saleId = `blob:<mutatie-id>`. Herhaalde POST boekt nooit dubbel. */
    mutationKey: text("mutation_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("loyalty_mutations_key_uq").on(t.mutationKey),
    index("loyalty_mutations_customer_idx").on(t.customerId),
    index("loyalty_mutations_sale_idx").on(t.saleId),
  ]
);

/* ─────────────── Klantprofiel 360 & doelgroepen (CDP-laag) ──────────────── */

/**
 * Identiteitsgrafiek: alle sleutels waarmee één klant herkend kan worden.
 *
 * De aanleiding staat in het geheugen als "identiteitsprobleem SRS-nr vs uuid":
 * dezelfde persoon leefde als uuid (orders, loyalty, posSales), als
 * SRS-klantnummer (storePurchases), als los e-mailadres (tickets, retouren,
 * afspraken, nieuwsbrief) en als wallet-pascode. Elke koppeling werd ad hoc op
 * e-mail gedaan, met een stille terugval op "de eerste treffer" als dat niet
 * lukte. Dit is de ene plek waar die sleutels bij elkaar komen.
 *
 * Uniek op (kind, value): een device of e-mailadres hangt aan precies één
 * klant. Botst een nieuwe koppeling, dan wint de bestaande en waarschuwt de
 * code — stil overschrijven zou de historie van de vórige klant naar de nieuwe
 * verhuizen, en dat is een privacylek, geen datafoutje.
 */
export const customerIdentities = pgTable(
  "customer_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** 'device' | 'email' | 'srs' | 'phone' | 'wallet' | 'pos'. */
    kind: text("kind").notNull(),
    /** Genormaliseerd: e-mail lowercase+trim, telefoon E.164, device = rauwe sid. */
    value: text("value").notNull(),
    /** 'zeker' (ingelogd/afgerekend) of 'afgeleid' (op e-mail gematcht zonder
     *  login). Doelgroepen die geld kosten mogen kiezen om alleen 'zeker' mee te
     *  nemen — een verkeerd gekoppeld device is een advertentie aan de verkeerde
     *  persoon. */
    zekerheid: text("zekerheid").notNull().default("zeker"),
    bron: text("bron").notNull().default(""),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customer_identities_uniek").on(t.kind, t.value),
    index("customer_identities_klant_idx").on(t.customerId),
  ]
);

/**
 * Het 360-profiel, platgeslagen en per nacht herbouwd.
 *
 * Waarom gematerialiseerd en niet live: het profiel raakt twaalf tabellen
 * (orders, orderregels, posSales, storePurchases, returns, loyalty, vouchers,
 * cadeaubonnen, tickets, afspraken, reviews, events). Dat is prima voor één
 * klantkaart, maar een doelgroep telt over 46.000 klanten en moet in de portal
 * binnen een seconde een aantal tonen. Deze tabel is de leescopie waar élke
 * doelgroepregel op draait; lib/customer-360 bouwt hem.
 *
 * De _sha256-velden zijn wat naar Meta en Google Ads gaat: die matchen op een
 * genormaliseerde hash, nooit op het rauwe adres. Vooraf berekend, zodat een
 * uitlevering van 20k klanten niet 20k keer staat te hashen.
 */
export const customerProfiles = pgTable(
  "customer_profiles",
  {
    customerId: uuid("customer_id")
      .primaryKey()
      .references(() => customers.id, { onDelete: "cascade" }),

    email: text("email").notNull().default(""),
    emailSha256: text("email_sha256").notNull().default(""),
    phoneE164: text("phone_e164").notNull().default(""),
    phoneSha256: text("phone_sha256").notNull().default(""),
    voornaamSha256: text("voornaam_sha256").notNull().default(""),
    achternaamSha256: text("achternaam_sha256").notNull().default(""),
    postcode: text("postcode").notNull().default(""),
    plaats: text("plaats").notNull().default(""),
    land: text("land").notNull().default("NL"),
    srsCustomerId: text("srs_customer_id").notNull().default(""),

    ordersOnline: integer("orders_online").notNull().default(0),
    ordersWinkel: integer("orders_winkel").notNull().default(0),
    ordersTotaal: integer("orders_totaal").notNull().default(0),
    besteedOnlineCents: integer("besteed_online_cents").notNull().default(0),
    besteedWinkelCents: integer("besteed_winkel_cents").notNull().default(0),
    besteedTotaalCents: integer("besteed_totaal_cents").notNull().default(0),
    gemOrderwaardeCents: integer("gem_orderwaarde_cents").notNull().default(0),
    eersteAankoop: timestamp("eerste_aankoop", { withTimezone: true }),
    laatsteAankoop: timestamp("laatste_aankoop", { withTimezone: true }),
    dagenSindsAankoop: integer("dagen_sinds_aankoop"),
    klantwaardeCents: integer("klantwaarde_cents").notNull().default(0),

    /** Retourquote in hele procenten. Een klant met 60% retour is een ándere
     *  doelgroep dan zijn omzet suggereert; zonder dit veld adverteer je je
     *  verlies groter. */
    retouren: integer("retouren").notNull().default(0),
    retourCents: integer("retour_cents").notNull().default(0),
    retourquote: integer("retourquote").notNull().default(0),

    punten: integer("punten").notNull().default(0),
    puntenBeschikbaar: integer("punten_beschikbaar").notNull().default(0),
    tegoedCents: integer("tegoed_cents").notNull().default(0),
    actieveVouchers: integer("actieve_vouchers").notNull().default(0),
    walletPas: boolean("wallet_pas").notNull().default(false),
    /** Punten die uit de eenmalige actie-bonussen kwamen — wie reageert op een prikkel. */
    bonusPunten: integer("bonus_punten").notNull().default(0),
    /** Heeft de klant ZELF z'n maten opgegeven? Iets anders dan `maten` hieronder:
     *  dat zijn de maten die hij gekocht heeft, afgeleid uit de orderregels.
     *  Zonder opgegeven maat is een verkeerde-maat-retour veel waarschijnlijker,
     *  dus dit is de doelgroep waar de retour-campagnes op mikken. */
    maatprofiel: boolean("maatprofiel").notNull().default(false),
    /** Voldoet aan de profiel-checklist (lib/profiel-voorkeuren). */
    profielCompleet: boolean("profiel_compleet").notNull().default(false),

    sessies30d: integer("sessies_30d").notNull().default(0),
    productviews30d: integer("productviews_30d").notNull().default(0),
    zoekopdrachten30d: integer("zoekopdrachten_30d").notNull().default(0),
    laatstGezien: timestamp("laatst_gezien", { withTimezone: true }),
    /** Laatste add_to_cart zónder aankoop erna — de winkelwagenverlaters. */
    karVerlatenOp: timestamp("kar_verlaten_op", { withTimezone: true }),
    laatstBekeken: jsonb("laatst_bekeken").notNull().default([]),

    tickets: integer("tickets").notNull().default(0),
    afspraken: integer("afspraken").notNull().default(0),
    reviews: integer("reviews").notNull().default(0),

    topCategorieen: jsonb("top_categorieen").notNull().default([]),
    topMerken: jsonb("top_merken").notNull().default([]),
    topKleuren: jsonb("top_kleuren").notNull().default([]),
    maten: jsonb("maten").notNull().default({}),
    favorieteWinkel: text("favoriete_winkel").notNull().default(""),
    /** 'online' | 'winkel' | 'omni' | 'geen'. */
    kanaal: text("kanaal").notNull().default("geen"),

    /** Drie losse waarheden die tot nu toe door elkaar liepen. Een doelgroep die
     *  naar een advertentieplatform of de mail gaat mag alleen op de eerste twee
     *  leunen; de cookie-marketingkeuze geldt voor tags op de site. */
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    nieuwsbrief: text("nieuwsbrief").notNull().default("geen"),
    whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),

    rfmR: integer("rfm_r").notNull().default(0),
    rfmF: integer("rfm_f").notNull().default(0),
    rfmM: integer("rfm_m").notNull().default(0),
    /** nieuw | trouw | vip | slapend | risico | eenmalig | verloren | geen. */
    segment: text("segment").notNull().default("geen"),

    /** Grote maten — Kevin wil deze groep expliciet kunnen benaderen. Afgeleid
     *  langs TWEE wegen: lidmaatschap van de collectie 'Grote maten' én de
     *  gekochte maten zelf. Eén weg is niet genoeg: de collectie dekt niet alle
     *  artikelen, en een maat zegt per categorie iets anders. */
    groteMaten: boolean("grote_maten").notNull().default(false),
    maatprofielCompleet: boolean("maatprofiel_compleet").notNull().default(false),

    /** Prijsgevoeligheid als PERCENTAGE van de orders met korting. Wie alleen in
     *  de sale koopt is een andere campagne dan wie vol tarief betaalt — en die
     *  tweede groep wil je nóóit een kortingsmail sturen. */
    kortingsaandeel: integer("kortingsaandeel").notNull().default(0),
    ordersMetKorting: integer("orders_met_korting").notNull().default(0),

    zakelijk: boolean("zakelijk").notNull().default(false),
    cadeaukoper: boolean("cadeaukoper").notNull().default(false),
    taal: text("taal").notNull().default("nl"),
    betaalmethode: text("betaalmethode").notNull().default(""),
    bezorgvoorkeur: text("bezorgvoorkeur").notNull().default(""),
    /** In welke maanden koopt deze klant. Voedt seizoenscampagnes: wie elk jaar
     *  in mei een pak koopt (trouwseizoen) benader je in april, niet in
     *  november. */
    aankoopmaanden: jsonb("aankoopmaanden").notNull().default([]),

    mailVerstuurd: integer("mail_verstuurd").notNull().default(0),
    mailGeopend: integer("mail_geopend").notNull().default(0),
    mailGeklikt: integer("mail_geklikt").notNull().default(0),
    mailOpenratio: integer("mail_openratio").notNull().default(0),
    mailLaatstGeopend: timestamp("mail_laatst_geopend", { withTimezone: true }),

    /** Externe kanalen apart geteld. "Koopt bij ons én op Bol" is een eigen
     *  groep: die klant kun je met een reden naar het eigen kanaal halen, en dat
     *  scheelt marge. */
    ordersBol: integer("orders_bol").notNull().default(0),
    besteedBolCents: integer("besteed_bol_cents").notNull().default(0),
    ordersShopify: integer("orders_shopify").notNull().default(0),
    besteedShopifyCents: integer("besteed_shopify_cents").notNull().default(0),

    retourRedenen: jsonb("retour_redenen").notNull().default([]),

    attributie: jsonb("attributie").notNull().default({}),
    berekendOp: timestamp("berekend_op", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("customer_profiles_segment_idx").on(t.segment),
    index("customer_profiles_grote_maten_idx").on(t.groteMaten),
    index("customer_profiles_korting_idx").on(t.kortingsaandeel),
    index("customer_profiles_mail_idx").on(t.mailOpenratio),
    index("customer_profiles_kanaal_idx").on(t.kanaal),
    index("customer_profiles_besteed_idx").on(t.besteedTotaalCents),
    index("customer_profiles_laatste_idx").on(t.laatsteAankoop),
    index("customer_profiles_optin_idx").on(t.marketingOptIn),
    index("customer_profiles_winkel_idx").on(t.favorieteWinkel),
    index("customer_profiles_rfm_idx").on(t.rfmR, t.rfmF, t.rfmM),
    index("customer_profiles_maatprofiel_idx").on(t.maatprofiel, t.marketingOptIn),
    index("customer_profiles_compleet_idx").on(t.profielCompleet, t.marketingOptIn),
  ]
);

/**
 * Doelgroep: een herbruikbare selectie klanten die naar één of meer kanalen
 * uitgeleverd wordt (mail, Meta, Google Ads, of gewoon een export).
 *
 * `definitie` is een regelBOOM als data, geen SQL-string. De regels worden in de
 * portal geklikt en server-side vertaald tegen een vaste veldenlijst
 * (lib/audience-regels). Vrije SQL in een kolom is een injectiedeur die vanzelf
 * een keer opengaat.
 */
export const audiences = pgTable(
  "audiences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    naam: text("naam").notNull(),
    omschrijving: text("omschrijving").notNull().default(""),
    definitie: jsonb("definitie").notNull().default({}),
    /** 'dynamisch' = elke nacht opnieuw bepaald, 'statisch' = eenmalig vastgezet. */
    soort: text("soort").notNull().default("dynamisch"),
    actief: boolean("actief").notNull().default(true),
    /** {"resend":{...},"meta":{...},"google":{...}} — per kanaal de instellingen. */
    kanalen: jsonb("kanalen").notNull().default({}),
    aantal: integer("aantal").notNull().default(0),
    /** Hoeveel daarvan daadwerkelijk te bereiken zijn (opt-in + adres bekend).
     *  Het verschil met `aantal` is precies waar een campagne op stukloopt. */
    aantalBereikbaar: integer("aantal_bereikbaar").notNull().default(0),
    laatstGebouwd: timestamp("laatst_gebouwd", { withTimezone: true }),
    aangemaaktDoor: text("aangemaakt_door").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("audiences_slug_uniek").on(t.slug), index("audiences_actief_idx").on(t.actief)]
);

export const audienceMembers = pgTable(
  "audience_members",
  {
    audienceId: uuid("audience_id")
      .notNull()
      .references(() => audiences.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    toegevoegdOp: timestamp("toegevoegd_op", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "audience_members_pk", columns: [t.audienceId, t.customerId] }),
    index("audience_members_klant_idx").on(t.customerId),
  ]
);

/**
 * Uitleverlogboek: per kanaal per keer hoeveel erbij kwamen, hoeveel eraf
 * gingen en wat er misging. Zonder dit logboek weet je bij een scheve
 * Meta-doelgroep nooit of het aan de regel lag of aan de uitlevering.
 */
export const audienceSyncs = pgTable(
  "audience_syncs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    audienceId: uuid("audience_id")
      .notNull()
      .references(() => audiences.id, { onDelete: "cascade" }),
    /** 'resend' | 'meta' | 'google' | 'csv'. */
    kanaal: text("kanaal").notNull(),
    /** 'bezig' | 'klaar' | 'fout'. */
    status: text("status").notNull().default("bezig"),
    toegevoegd: integer("toegevoegd").notNull().default(0),
    verwijderd: integer("verwijderd").notNull().default(0),
    /** Overgeslagen wegens ontbrekende toestemming of onbruikbaar adres. */
    overgeslagen: integer("overgeslagen").notNull().default(0),
    fout: text("fout").notNull().default(""),
    externId: text("extern_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audience_syncs_audience_idx").on(t.audienceId, t.createdAt)]
);

/* ───────────────── Externe bronnen in het klantbeeld ────────────────────── */

/**
 * Bestellingen die buiten ons eigen ordermodel omgaan: Bol.com, en straks elk
 * ander marktplaats-kanaal.
 *
 * Eén tabel per SOORT FEIT, niet per systeem: een bestelling bij Bol en een bij
 * een toekomstig kanaal zijn allebei "een externe order", ze verschillen in
 * `bron`. Vijf losse tabellen zouden vijf keer dezelfde vraag anders
 * beantwoorden. Shopify hoort hier bewust NIET bij: dat is onze eigen webshop,
 * die landt via lib/shopify-sync gewoon in `orders`, zodat het profiel en alle
 * rapportages er zonder uitzondering mee rekenen.
 *
 * `data` bewaart het ruwe record, zodat een verkeerde interpretatie later te
 * herstellen is zonder opnieuw bij de bron te moeten trekken.
 */
export const externeOrders = pgTable(
  "externe_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 'bol' | 'srs' | … */
    bron: text("bron").notNull(),
    externId: text("extern_id").notNull(),
    orderNummer: text("order_nummer").notNull().default(""),
    /** Brugsleutel: externe systemen kennen onze uuid niet. */
    email: text("email").notNull().default(""),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    status: text("status").notNull().default(""),
    totalCents: integer("total_cents").notNull().default(0),
    kortingCents: integer("korting_cents").notNull().default(0),
    besteldOp: timestamp("besteld_op", { withTimezone: true }).notNull(),
    postcode: text("postcode").notNull().default(""),
    plaats: text("plaats").notNull().default(""),
    land: text("land").notNull().default("NL"),
    telefoon: text("telefoon").notNull().default(""),
    regels: jsonb("regels").notNull().default([]),
    data: jsonb("data").notNull().default({}),
    opgehaaldOp: timestamp("opgehaald_op", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Zonder deze unieke index verdubbelt élke sync de omzet van een klant.
    uniqueIndex("externe_orders_uniek").on(t.bron, t.externId),
    index("externe_orders_klant_idx").on(t.customerId),
    index("externe_orders_tijd_idx").on(t.bron, t.besteldOp),
  ]
);

/**
 * Mailgedrag per adres (Spotler, en desgewenst Resend).
 *
 * Geaggregeerd, niet per bericht: we willen weten óf iemand onze mail leest,
 * niet welke. Dat scheelt miljoenen rijen en het is precies wat een doelgroep
 * nodig heeft — "opent al een jaar niets" verdient een eigen campagne, en een
 * adres dat structureel bouncet moet je uit je uitleveringen houden voordat je
 * afzenderreputatie eronder lijdt.
 */
export const mailEngagement = pgTable(
  "mail_engagement",
  {
    email: text("email").primaryKey(),
    bron: text("bron").notNull().default("spotler"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    verstuurd: integer("verstuurd").notNull().default(0),
    geopend: integer("geopend").notNull().default(0),
    geklikt: integer("geklikt").notNull().default(0),
    gebounced: integer("gebounced").notNull().default(0),
    afgemeld: boolean("afgemeld").notNull().default(false),
    laatstVerstuurd: timestamp("laatst_verstuurd", { withTimezone: true }),
    laatstGeopend: timestamp("laatst_geopend", { withTimezone: true }),
    laatstGeklikt: timestamp("laatst_geklikt", { withTimezone: true }),
    bijgewerktOp: timestamp("bijgewerkt_op", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mail_engagement_klant_idx").on(t.customerId)]
);

/**
 * Retouren die buiten ons eigen retourportaal omgaan (Returnista).
 *
 * De REDEN is het hele punt van deze tabel. "Te klein" vraagt om beter
 * maatadvies, "voldeed niet aan de verwachting" om betere foto's, "te laat
 * geleverd" om iets heel anders. Zonder reden is een retour alleen een
 * kostenpost en leer je er niets van.
 */
export const externeRetouren = pgTable(
  "externe_retouren",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bron: text("bron").notNull().default("returnista"),
    externId: text("extern_id").notNull(),
    orderRef: text("order_ref").notNull().default(""),
    email: text("email").notNull().default(""),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    status: text("status").notNull().default(""),
    reden: text("reden").notNull().default(""),
    bedragCents: integer("bedrag_cents").notNull().default(0),
    regels: jsonb("regels").notNull().default([]),
    aangemeldOp: timestamp("aangemeld_op", { withTimezone: true }),
    data: jsonb("data").notNull().default({}),
    opgehaaldOp: timestamp("opgehaald_op", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("externe_retouren_uniek").on(t.bron, t.externId),
    index("externe_retouren_klant_idx").on(t.customerId),
  ]
);
