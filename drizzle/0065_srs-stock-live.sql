-- Live SRS-voorraadstand per (filiaal, sku): schaduw van de 5-min storeinfo-SFTP-delta's,
-- dual-write naast de per-filiaal blob-snapshot (fase 1 "alles naar Neon"). Nog geen lezers.
-- Handgeschreven migratie (drizzle-journaal stopt bij 0045 — zie repo-conventie).
CREATE TABLE IF NOT EXISTS "srs_stock_live" (
  "sku" text NOT NULL,
  "branch_id" text NOT NULL,
  "store" text NOT NULL DEFAULT '',
  "qty" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "srs_stock_live_branch_id_sku_pk" PRIMARY KEY ("branch_id", "sku")
);
CREATE INDEX IF NOT EXISTS "srs_stock_live_sku_idx" ON "srs_stock_live" ("sku");
