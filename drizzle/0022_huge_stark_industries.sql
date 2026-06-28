CREATE TABLE "pos_sales" (
	"id" text PRIMARY KEY NOT NULL,
	"client_ref" text DEFAULT '' NOT NULL,
	"store" text NOT NULL,
	"cashier" text DEFAULT '' NOT NULL,
	"cashier_id" text DEFAULT '' NOT NULL,
	"customer_id" text DEFAULT '' NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"srs_posted" boolean DEFAULT false NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sales_clientref_unique" ON "pos_sales" USING btree ("client_ref") WHERE "pos_sales"."client_ref" <> '';--> statement-breakpoint
CREATE INDEX "pos_sales_store_created_idx" ON "pos_sales" USING btree ("store","created_at");--> statement-breakpoint
CREATE INDEX "pos_sales_store_flags_idx" ON "pos_sales" USING btree ("store","cancelled","srs_posted");