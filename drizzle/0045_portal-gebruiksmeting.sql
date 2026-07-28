CREATE TABLE "portal_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dag" date NOT NULL,
	"pad" text NOT NULL,
	"gebruiker_id" text DEFAULT '' NOT NULL,
	"gebruiker_naam" text DEFAULT '' NOT NULL,
	"soort" text DEFAULT '' NOT NULL,
	"winkel" text DEFAULT '' NOT NULL,
	"aantal" integer DEFAULT 1 NOT NULL,
	"laatst_op" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_usage_uq" ON "portal_usage" USING btree ("dag","pad","gebruiker_id");--> statement-breakpoint
CREATE INDEX "portal_usage_pad_idx" ON "portal_usage" USING btree ("pad");--> statement-breakpoint
CREATE INDEX "portal_usage_dag_idx" ON "portal_usage" USING btree ("dag");