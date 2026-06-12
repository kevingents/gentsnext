ALTER TABLE "product_variants" ADD COLUMN "color_family" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "variants_color_family_idx" ON "product_variants" USING btree ("color_family");--> statement-breakpoint
CREATE INDEX "variants_size_idx" ON "product_variants" USING btree ("size");