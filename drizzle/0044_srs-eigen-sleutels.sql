ALTER TABLE "product_variants" ADD COLUMN "supplier_ean" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "srs_artikel_nummer" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "srs_kleur_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "handmatige_velden" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "srs_gezien_op" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "products_srs_artikel_kleur_unique" ON "products" USING btree ("srs_artikel_nummer","srs_kleur_id") WHERE "products"."srs_artikel_nummer" <> '';