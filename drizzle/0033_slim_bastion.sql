CREATE TABLE "srs_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gen" text NOT NULL,
	"sku" text NOT NULL,
	"branch_id" text NOT NULL,
	"store" text DEFAULT '' NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"tekort" integer DEFAULT 0 NOT NULL,
	"ideaal" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srs_stock_meta" (
	"id" text PRIMARY KEY NOT NULL,
	"active_gen" text,
	"synced_at" timestamp with time zone,
	"row_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "srs_stock_gen_sku_idx" ON "srs_stock" USING btree ("gen","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "srs_stock_gen_branch_sku_unique" ON "srs_stock" USING btree ("gen","branch_id","sku");