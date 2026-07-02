CREATE TABLE "order_shipment_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"shipment_key" text NOT NULL,
	"store" text DEFAULT '' NOT NULL,
	"picked_by" text DEFAULT '' NOT NULL,
	"picked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_shipment_picks_uq" ON "order_shipment_picks" USING btree ("order_number","shipment_key");--> statement-breakpoint
CREATE INDEX "order_shipment_picks_order_idx" ON "order_shipment_picks" USING btree ("order_number");