-- PIM-fundering: sleutels die niet aan Shopify hangen.
--
-- Vandaag is de catalogus alleen uniek via shopify_product_id / shopify_variant_id.
-- Zodra Shopify uit de keten gaat, kan de import niets meer upserten: er is geen
-- tweede unieke sleutel, en 11.651 van de 34.499 varianten hebben noch sku noch
-- barcode. Deze migratie legt de SRS-eigen sleutels aan zodat de bron kan wisselen
-- zonder dat de catalogus opnieuw opgebouwd hoeft te worden.
--
-- Sleutelmodel (drie niveaus, zoals in een PIM):
--   model    = srs_artikel_nummer
--   product  = srs_artikel_nummer + srs_kleur_id   (wat de klant als één product ziet)
--   variant  = sku                                  (de SRS-barcode 29000..., matcht srs_stock)
--
-- Alles is additief: geen kolom verdwijnt, geen bestaande index wijzigt. De
-- Shopify-kolommen blijven staan tot de import bewezen op SRS draait.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "srs_artikel_nummer" text NOT NULL DEFAULT '';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "srs_kleur_id" text NOT NULL DEFAULT '';

-- De leveranciers-EAN krijgt een eigen kolom. Nu staat die in product_variants.barcode,
-- waardoor elke lookup die `barcode || sku` als sleutel gebruikt op een nummer zoekt dat
-- srs_stock niet kent — de oorzaak van "systeem 0" op de handscanner. Na de SRS-import
-- verhuist de EAN hierheen en wordt barcode weer wat het schema altijd beloofde.
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "supplier_ean" text NOT NULL DEFAULT '';

-- Herkomst per veld: welke velden zijn handmatig overschreven en mogen door een
-- SRS-import NIET teruggezet worden. Zonder deze scheiding wist de volgende import
-- de verrijking, precies zoals eerder gebeurde met de onzin-omschrijvingen.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "handmatige_velden" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "srs_gezien_op" timestamptz;

-- Partieel uniek: lege waarden mogen blijven bestaan zolang de oude import nog draait.
CREATE UNIQUE INDEX IF NOT EXISTS "products_srs_artikel_kleur_unique"
  ON "products" ("srs_artikel_nummer", "srs_kleur_id")
  WHERE "srs_artikel_nummer" <> '';

-- BEWUST NIET UNIEK. Nagemeten op productie 28 juli: 22.848 varianten met een sku,
-- 22.744 unieke waarden — er staan 104 duplicaten in (o.a. 2900001943031, tweemaal).
-- Een unieke index zou deze migratie dus laten mislukken. De uniciteit komt pas als
-- SRS de bron is: daar is de barcode per definitie uniek per fysieke variant. De
-- opschoning van die 104 hoort bij de SRS-import, niet bij een schemawijziging.
CREATE INDEX IF NOT EXISTS "variants_sku_idx"
  ON "product_variants" ("sku")
  WHERE "sku" <> '';

CREATE INDEX IF NOT EXISTS "products_srs_artikel_idx"
  ON "products" ("srs_artikel_nummer")
  WHERE "srs_artikel_nummer" <> '';

CREATE INDEX IF NOT EXISTS "variants_supplier_ean_idx"
  ON "product_variants" ("supplier_ean")
  WHERE "supplier_ean" <> '';
