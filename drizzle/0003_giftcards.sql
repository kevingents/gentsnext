CREATE TABLE "giftcard_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"giftcard_id" uuid NOT NULL,
	"delta_cents" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"order_number" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giftcards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"initial_cents" integer NOT NULL,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recipient_name" text DEFAULT '' NOT NULL,
	"recipient_email" text DEFAULT '' NOT NULL,
	"sender_name" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"buyer_email" text DEFAULT '' NOT NULL,
	"customer_id" uuid,
	"mollie_payment_id" text,
	"expires_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "giftcard_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "giftcard_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "giftcard_transactions" ADD CONSTRAINT "giftcard_transactions_giftcard_id_giftcards_id_fk" FOREIGN KEY ("giftcard_id") REFERENCES "public"."giftcards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giftcards" ADD CONSTRAINT "giftcards_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "giftcard_tx_card_idx" ON "giftcard_transactions" USING btree ("giftcard_id");--> statement-breakpoint
CREATE INDEX "giftcard_tx_order_idx" ON "giftcard_transactions" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "giftcards_code_unique" ON "giftcards" USING btree ("code");--> statement-breakpoint
CREATE INDEX "giftcards_mollie_idx" ON "giftcards" USING btree ("mollie_payment_id");--> statement-breakpoint
CREATE INDEX "giftcards_recipient_idx" ON "giftcards" USING btree ("recipient_email");--> statement-breakpoint
CREATE INDEX "giftcards_customer_idx" ON "giftcards" USING btree ("customer_id");