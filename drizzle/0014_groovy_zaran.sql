ALTER TABLE "returns" ADD COLUMN "stock_corrected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "stock_corrected_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "returns_stockcorr_idx" ON "returns" USING btree ("stock_corrected_at");