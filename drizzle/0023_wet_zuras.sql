CREATE TABLE "inbound_receipt_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"stock_key" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"barcode" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"expected_qty" integer DEFAULT 0 NOT NULL,
	"scanned_qty" integer DEFAULT 0 NOT NULL,
	"blind" boolean DEFAULT false NOT NULL,
	"first_scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"source_type" text DEFAULT 'transfer' NOT NULL,
	"from_location" text DEFAULT '' NOT NULL,
	"to_store" text NOT NULL,
	"status" text DEFAULT 'picked' NOT NULL,
	"link_ref" text DEFAULT '' NOT NULL,
	"parts" integer DEFAULT 1 NOT NULL,
	"expected_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"picked_by" text DEFAULT '' NOT NULL,
	"received_by" text DEFAULT '' NOT NULL,
	"picked_at" timestamp with time zone,
	"in_transit_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_receipt_counts" ADD CONSTRAINT "inbound_receipt_counts_shipment_id_inbound_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."inbound_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_counts_shipment_key_unique" ON "inbound_receipt_counts" USING btree ("shipment_id","stock_key");--> statement-breakpoint
CREATE INDEX "inbound_counts_shipment_idx" ON "inbound_receipt_counts" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "inbound_tostore_status_idx" ON "inbound_shipments" USING btree ("to_store","status");--> statement-breakpoint
CREATE INDEX "inbound_source_idx" ON "inbound_shipments" USING btree ("source");--> statement-breakpoint
CREATE INDEX "inbound_created_idx" ON "inbound_shipments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inbound_linkref_idx" ON "inbound_shipments" USING btree ("link_ref");