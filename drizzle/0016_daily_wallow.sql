CREATE TABLE "fulfillment_misses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"store" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"rerouted_to" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fmiss_store_idx" ON "fulfillment_misses" USING btree ("store");--> statement-breakpoint
CREATE INDEX "fmiss_order_idx" ON "fulfillment_misses" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "fmiss_created_idx" ON "fulfillment_misses" USING btree ("created_at");