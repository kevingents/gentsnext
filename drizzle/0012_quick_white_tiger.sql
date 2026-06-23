CREATE TABLE "web_stock_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"location" text NOT NULL,
	"stock_key" text NOT NULL,
	"qty" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_stock_reservation_counter" (
	"location" text NOT NULL,
	"stock_key" text NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_stock_reservation_counter_location_stock_key_pk" PRIMARY KEY("location","stock_key")
);
--> statement-breakpoint
CREATE INDEX "wsh_order_idx" ON "web_stock_holds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "wsh_loc_key_idx" ON "web_stock_holds" USING btree ("location","stock_key");--> statement-breakpoint
CREATE INDEX "wsh_expires_idx" ON "web_stock_holds" USING btree ("expires_at");