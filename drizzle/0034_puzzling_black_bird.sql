CREATE TABLE "store_print_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store" text NOT NULL,
	"type" text DEFAULT 'pick' NOT NULL,
	"ref" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"printed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "spj_store_status_idx" ON "store_print_jobs" USING btree ("store","status");--> statement-breakpoint
CREATE UNIQUE INDEX "spj_store_ref_type_unique" ON "store_print_jobs" USING btree ("store","ref","type") WHERE ref <> '';