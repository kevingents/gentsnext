CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"stock_key" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"barcode" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"scanned_qty" integer DEFAULT 0 NOT NULL,
	"expected_qty" integer DEFAULT 0 NOT NULL,
	"first_scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"type" text DEFAULT 'full' NOT NULL,
	"section" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"started_by" text DEFAULT '' NOT NULL,
	"completed_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_session_id_inventory_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inventory_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inv_counts_session_key_unique" ON "inventory_counts" USING btree ("session_id","stock_key");--> statement-breakpoint
CREATE INDEX "inv_counts_session_idx" ON "inventory_counts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "inv_sessions_loc_idx" ON "inventory_sessions" USING btree ("location","status");--> statement-breakpoint
CREATE INDEX "inv_sessions_created_idx" ON "inventory_sessions" USING btree ("created_at");