CREATE TABLE "store_stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location" text NOT NULL,
	"stock_key" text NOT NULL,
	"delta" integer NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"ref" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ssm_loc_key_idx" ON "store_stock_movements" USING btree ("location","stock_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ssm_ref_unique" ON "store_stock_movements" USING btree ("ref","channel","stock_key");