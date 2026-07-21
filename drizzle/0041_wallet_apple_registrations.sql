CREATE TABLE "wallet_apple_registrations" (
	"device_library_identifier" text NOT NULL,
	"serial_number" text NOT NULL,
	"push_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_apple_registrations_device_library_identifier_serial_number_pk" PRIMARY KEY("device_library_identifier","serial_number")
);
--> statement-breakpoint
CREATE INDEX "wallet_apple_reg_serial_idx" ON "wallet_apple_registrations" USING btree ("serial_number");