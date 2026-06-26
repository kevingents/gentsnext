ALTER TABLE "inventory_sessions" ADD COLUMN "scope" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_sessions" ADD COLUMN "scope_values" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_sessions" ADD COLUMN "scope_skus" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_sessions" ADD COLUMN "assigned_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_sessions" ADD COLUMN "approved_by" text DEFAULT '' NOT NULL;