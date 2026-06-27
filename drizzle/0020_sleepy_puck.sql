CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location" text NOT NULL,
	"customer_id" text DEFAULT '' NOT NULL,
	"customer_email" text DEFAULT '' NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_phone" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_until" timestamp with time zone,
	"paid" boolean DEFAULT false NOT NULL,
	"pay_token" text DEFAULT '' NOT NULL,
	"converted_order_id" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "reservations_loc_status_idx" ON "reservations" USING btree ("location","status");--> statement-breakpoint
CREATE INDEX "reservations_customer_idx" ON "reservations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "reservations_paytoken_idx" ON "reservations" USING btree ("pay_token");