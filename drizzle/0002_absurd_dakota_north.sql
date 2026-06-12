ALTER TABLE "product_variants" ADD COLUMN "size_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "variants_size_label_idx" ON "product_variants" USING btree ("size_label");