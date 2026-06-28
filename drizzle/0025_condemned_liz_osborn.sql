CREATE TABLE "receiving_discrepancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"source_type" text DEFAULT 'transfer' NOT NULL,
	"to_store" text DEFAULT '' NOT NULL,
	"link_ref" text DEFAULT '' NOT NULL,
	"stock_key" text DEFAULT '' NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"expected_qty" integer DEFAULT 0 NOT NULL,
	"scanned_qty" integer DEFAULT 0 NOT NULL,
	"variance" integer DEFAULT 0 NOT NULL,
	"code" text DEFAULT 'SHORT' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"photo_url" text DEFAULT '' NOT NULL,
	"resolved_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "receiving_discrepancies" ADD CONSTRAINT "receiving_discrepancies_shipment_id_inbound_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."inbound_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recdisc_source_idx" ON "receiving_discrepancies" USING btree ("source","created_at");--> statement-breakpoint
CREATE INDEX "recdisc_store_idx" ON "receiving_discrepancies" USING btree ("to_store","created_at");--> statement-breakpoint
CREATE INDEX "recdisc_code_idx" ON "receiving_discrepancies" USING btree ("code");--> statement-breakpoint
CREATE INDEX "recdisc_status_idx" ON "receiving_discrepancies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "recdisc_shipment_idx" ON "receiving_discrepancies" USING btree ("shipment_id");