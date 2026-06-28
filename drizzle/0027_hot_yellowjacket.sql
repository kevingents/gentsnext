ALTER TABLE "inbound_receipt_counts" ADD COLUMN "flag_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_receipt_counts" ADD COLUMN "flag_qty" integer DEFAULT 0 NOT NULL;