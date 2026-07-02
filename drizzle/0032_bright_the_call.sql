CREATE TABLE "pos_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store" text NOT NULL,
	"date" text NOT NULL,
	"dagstaat" jsonb NOT NULL,
	"kasopmaak" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"actor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mailed_at" timestamp with time zone,
	"mail_status" text DEFAULT '' NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_closings_store_date_unique" ON "pos_closings" USING btree ("store","date");--> statement-breakpoint
CREATE INDEX "pos_closings_store_date_idx" ON "pos_closings" USING btree ("store","date");