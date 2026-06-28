ALTER TABLE "inbound_shipments" ADD COLUMN "ship_method" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_shipments" ADD COLUMN "planned_route_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_shipments" ADD COLUMN "urgent" boolean DEFAULT false NOT NULL;