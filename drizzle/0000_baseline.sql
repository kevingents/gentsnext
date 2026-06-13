CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"title" text NOT NULL,
	"description_html" text DEFAULT '' NOT NULL,
	"seo_title" text DEFAULT '' NOT NULL,
	"seo_description" text DEFAULT '' NOT NULL,
	"shopify_collection_id" text,
	"rules" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text DEFAULT 'Thuis' NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"street" text DEFAULT '' NOT NULL,
	"house_number" text DEFAULT '' NOT NULL,
	"postal_code" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'NL' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"kind" text DEFAULT 'session' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"password_hash" text,
	"srs_customer_id" text,
	"loyalty_points" integer DEFAULT 0 NOT NULL,
	"size_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"handle" text DEFAULT '' NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"value_cents" integer DEFAULT 0 NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"product_handle" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"group_id" text,
	"role_label" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"customer_id" uuid,
	"access_token" text,
	"email" text NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"street" text DEFAULT '' NOT NULL,
	"house_number" text DEFAULT '' NOT NULL,
	"postal_code" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'NL' NOT NULL,
	"delivery_method" text DEFAULT 'standard' NOT NULL,
	"voucher_code" text DEFAULT '' NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"mollie_payment_id" text,
	"payment_status" text,
	"paid_at" timestamp with time zone,
	"srs_pushed_at" timestamp with time zone,
	"fulfillment_plan" jsonb,
	"fulfillment_status" text DEFAULT 'pending' NOT NULL,
	"confirmation_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"compare_at_cents" integer,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_collections" (
	"product_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_collections_product_id_collection_id_pk" PRIMARY KEY("product_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_size_media" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"threshold" text DEFAULT 'XXL' NOT NULL,
	"url" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_translations" (
	"product_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description_html" text DEFAULT '' NOT NULL,
	"seo_title" text DEFAULT '' NOT NULL,
	"seo_description" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_translations_product_id_locale_pk" PRIMARY KEY("product_id","locale")
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"barcode" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"size_label" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"color_family" text DEFAULT '' NOT NULL,
	"price_cents" integer NOT NULL,
	"compare_at_cents" integer,
	"srs_artikel_id" text DEFAULT '' NOT NULL,
	"srs_rve_artikelnummer" text DEFAULT '' NOT NULL,
	"shopify_variant_id" text,
	"image_url" text DEFAULT '' NOT NULL,
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"title" text NOT NULL,
	"description_html" text DEFAULT '' NOT NULL,
	"vendor" text DEFAULT '' NOT NULL,
	"product_type" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"seo_title" text DEFAULT '' NOT NULL,
	"seo_description" text DEFAULT '' NOT NULL,
	"shopify_product_id" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_created_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"has_image" boolean DEFAULT false NOT NULL,
	"in_stock" boolean DEFAULT false NOT NULL,
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"stock_synced_at" timestamp with time zone,
	"model_image_url" text DEFAULT '' NOT NULL,
	"model_image_alt" text DEFAULT '' NOT NULL,
	"variant_group_key" text DEFAULT '' NOT NULL,
	"is_group_primary" boolean DEFAULT true NOT NULL,
	"group_color_count" integer DEFAULT 1 NOT NULL,
	"variant_color_label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"sku" text NOT NULL,
	"branch_id" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_levels_sku_branch_id_pk" PRIMARY KEY("sku","branch_id")
);
--> statement-breakpoint
CREATE TABLE "stock_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"product_handle" text NOT NULL,
	"product_title" text DEFAULT '' NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"srs_customer_id" text,
	"email" text,
	"store_name" text DEFAULT '' NOT NULL,
	"branch_id" text,
	"receipt_id" text,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"points_earned" integer DEFAULT 0 NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"question" text NOT NULL,
	"ai_answer" text DEFAULT '' NOT NULL,
	"confident" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"handled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"customer_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'amount' NOT NULL,
	"value_cents" integer DEFAULT 0 NOT NULL,
	"percent_off" integer DEFAULT 0 NOT NULL,
	"min_spend_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"single_use" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_events" ADD CONSTRAINT "loyalty_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_collections" ADD CONSTRAINT "product_collections_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_collections" ADD CONSTRAINT "product_collections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_size_media" ADD CONSTRAINT "product_size_media_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_purchases" ADD CONSTRAINT "store_purchases_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collections_handle_unique" ON "collections" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_shopify_id_unique" ON "collections" USING btree ("shopify_collection_id");--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_sessions_token_unique" ON "customer_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_sessions_customer_idx" ON "customer_sessions" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_unique" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "customers_srs_idx" ON "customers" USING btree ("srs_customer_id");--> statement-breakpoint
CREATE INDEX "events_type_time_idx" ON "events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "events_handle_idx" ON "events" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "events_query_idx" ON "events" USING btree ("query");--> statement-breakpoint
CREATE INDEX "events_session_idx" ON "events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "loyalty_events_customer_idx" ON "loyalty_events" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_unique" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_mollie_payment_unique" ON "orders" USING btree ("mollie_payment_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "price_history_variant_idx" ON "price_history" USING btree ("variant_id","valid_from");--> statement-breakpoint
CREATE INDEX "images_product_idx" ON "product_images" USING btree ("product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_shopify_id_unique" ON "product_variants" USING btree ("shopify_variant_id");--> statement-breakpoint
CREATE INDEX "variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "variants_sku_idx" ON "product_variants" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "variants_barcode_idx" ON "product_variants" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "variants_srs_artikel_idx" ON "product_variants" USING btree ("srs_artikel_id");--> statement-breakpoint
CREATE INDEX "variants_color_family_idx" ON "product_variants" USING btree ("color_family");--> statement-breakpoint
CREATE INDEX "variants_size_idx" ON "product_variants" USING btree ("size");--> statement-breakpoint
CREATE INDEX "variants_size_label_idx" ON "product_variants" USING btree ("size_label");--> statement-breakpoint
CREATE UNIQUE INDEX "products_handle_unique" ON "products" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "products_shopify_id_unique" ON "products" USING btree ("shopify_product_id");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "products_visible_idx" ON "products" USING btree ("status","has_image","in_stock");--> statement-breakpoint
CREATE INDEX "products_variant_group_idx" ON "products" USING btree ("variant_group_key");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_notifications_unique" ON "stock_notifications" USING btree ("email","phone","product_handle","sku");--> statement-breakpoint
CREATE INDEX "stock_notifications_status_idx" ON "stock_notifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stock_notifications_sku_idx" ON "stock_notifications" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "stock_notifications_handle_idx" ON "stock_notifications" USING btree ("product_handle");--> statement-breakpoint
CREATE INDEX "store_purchases_customer_idx" ON "store_purchases" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "store_purchases_srs_idx" ON "store_purchases" USING btree ("srs_customer_id");--> statement-breakpoint
CREATE INDEX "store_purchases_email_idx" ON "store_purchases" USING btree ("email");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_code_unique" ON "vouchers" USING btree ("code");--> statement-breakpoint
CREATE INDEX "vouchers_customer_idx" ON "vouchers" USING btree ("customer_id");