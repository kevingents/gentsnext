CREATE TABLE "return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"order_line_id" uuid,
	"sku" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"reason" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"method" text NOT NULL,
	"refund_type" text NOT NULL,
	"pickup_store" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"items_cents" integer DEFAULT 0 NOT NULL,
	"shipping_cost_cents" integer DEFAULT 0 NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"credit_code" text DEFAULT '' NOT NULL,
	"dhl_label_url" text DEFAULT '' NOT NULL,
	"dhl_tracking" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "return_lines_return_idx" ON "return_lines" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "returns_order_idx" ON "returns" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "returns_ordernr_idx" ON "returns" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "returns_email_idx" ON "returns" USING btree ("email");--> statement-breakpoint
CREATE INDEX "returns_status_idx" ON "returns" USING btree ("status");