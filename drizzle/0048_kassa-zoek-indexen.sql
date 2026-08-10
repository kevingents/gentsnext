-- Kassa-scan: expressie-indexen zodat de barcode-lookup weer een index gebruikt
-- (6 aug 2026).
--
-- /api/core/catalog/lookup filtert op lower(v.barcode) / lower(v.sku) /
-- lower(v.srs_artikel_id), maar de indexen uit 0000_baseline staan op de KALE
-- kolommen (variants_barcode_idx, variants_sku_idx, variants_srs_artikel_idx).
-- Een index op "barcode" helpt niet voor een filter op lower("barcode"), dus
-- Postgres deed een Parallel Seq Scan over alle ~34.500 varianten — bij élke
-- scan aan de kassa, want dit endpoint is stap 1 van de barcode-fastpath in
-- storegents article-search.
--
-- Gemeten met EXPLAIN ANALYZE op productie:
--   nu            31,0 ms   4796 buffers (~37 MB)  2 parallel workers
--   met deze idx   0,09 ms    10 buffers           BitmapOr over de drie
--
-- Bewust GEEN aanpassing van de query zelf: lower() weghalen zou de matching
-- hoofdlettergevoelig maken en dus scans laten mislukken die nu wél werken.
--
-- De kale indexen blijven staan: die worden gebruikt door de import- en
-- koppelpaden die exact (hoofdlettergevoelig) op sku/barcode zoeken.
--
-- Kosten: ~34.500 rijen, dus elke index is in ongeveer een seconde gebouwd.

CREATE INDEX IF NOT EXISTS "variants_barcode_lower_idx"
  ON "product_variants" (lower("barcode"));

CREATE INDEX IF NOT EXISTS "variants_sku_lower_idx"
  ON "product_variants" (lower("sku"));

CREATE INDEX IF NOT EXISTS "variants_srs_artikel_lower_idx"
  ON "product_variants" (lower("srs_artikel_id"));
