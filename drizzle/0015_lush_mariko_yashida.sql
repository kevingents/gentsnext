ALTER TABLE "store_stock_movements" ADD COLUMN "srs_posted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ssm_ref_idx" ON "store_stock_movements" USING btree ("ref");