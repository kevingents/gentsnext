ALTER TABLE "reviews" ADD COLUMN "source" text DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "external_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "reviews_external_idx" ON "reviews" USING btree ("external_id");