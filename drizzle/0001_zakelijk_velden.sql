ALTER TABLE "orders" ADD COLUMN "company_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "vat_number" text DEFAULT '' NOT NULL;