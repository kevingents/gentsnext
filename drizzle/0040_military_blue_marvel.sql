CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text DEFAULT 'trouwconsult' NOT NULL,
	"store" text NOT NULL,
	"preferred_date" date NOT NULL,
	"dagdeel" text DEFAULT 'geen-voorkeur' NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"wensen" text DEFAULT '' NOT NULL,
	"locale" text DEFAULT 'nl' NOT NULL,
	"status" text DEFAULT 'nieuw' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "appointments_store_date_idx" ON "appointments" USING btree ("store","preferred_date");--> statement-breakpoint
CREATE INDEX "appointments_status_idx" ON "appointments" USING btree ("status");