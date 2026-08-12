-- Compleet klantbeeld: externe bronnen + rijkere kenmerken (Kevin, 12 aug 2026).
--
-- Het 360-profiel stond, maar bleef leeg waar het het meest telt. Gemeten op
-- productie: 4 klanten met een winkelaankoop, 0 met gedrag, 2 met een ticket,
-- 0 met een review. De oorzaak is niet de code maar de aanvoer — gents.nl
-- draait nog op Shopify (de orders in Neon stoppen in juni), de winkelkant
-- hangt in SRS, Bol is een eigen wereld en de mailstatistieken komen uit
-- Spotler. Dit script legt de opslag aan waar die bronnen in landen.
--
-- Drie principes:
--  1. ÉÉN TABEL PER SOORT FEIT, niet per systeem. Een bestelling bij Bol en een
--     bestelling bij Shopify zijn allebei "een externe order"; ze verschillen in
--     `bron`, niet in structuur. Anders krijg je vijf tabellen die vijf keer
--     dezelfde vraag anders beantwoorden.
--  2. E-MAIL ALS BRUGSLEUTEL. Externe systemen kennen onze uuid niet. We slaan
--     het adres op én de klant-id zodra die te vinden is; de identiteitsgrafiek
--     doet de koppeling.
--  3. RUWE BRON BEWAREN. `data` houdt het originele record vast, zodat een
--     verkeerde interpretatie later te herstellen is zonder opnieuw te trekken.

/* ─────────────────── 1. Externe orders (Shopify, Bol) ──────────────────── */

CREATE TABLE IF NOT EXISTS "externe_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- 'shopify' | 'bol' | 'srs'
  "bron" text NOT NULL,
  "extern_id" text NOT NULL,
  "order_nummer" text DEFAULT '' NOT NULL,
  "email" text DEFAULT '' NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "status" text DEFAULT '' NOT NULL,
  "total_cents" integer DEFAULT 0 NOT NULL,
  "korting_cents" integer DEFAULT 0 NOT NULL,
  "besteld_op" timestamp with time zone NOT NULL,
  "postcode" text DEFAULT '' NOT NULL,
  "plaats" text DEFAULT '' NOT NULL,
  "land" text DEFAULT 'NL' NOT NULL,
  "telefoon" text DEFAULT '' NOT NULL,
  "regels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "opgehaald_op" timestamp with time zone DEFAULT now() NOT NULL
);

-- Uniek per (bron, extern_id): opnieuw ophalen werkt bij in plaats van te
-- dupliceren. Zonder deze index verdubbelt elke sync de omzet van een klant.
CREATE UNIQUE INDEX IF NOT EXISTS "externe_orders_uniek" ON "externe_orders" ("bron", "extern_id");
CREATE INDEX IF NOT EXISTS "externe_orders_klant_idx" ON "externe_orders" ("customer_id");
CREATE INDEX IF NOT EXISTS "externe_orders_email_idx" ON "externe_orders" (lower("email"));
CREATE INDEX IF NOT EXISTS "externe_orders_tijd_idx" ON "externe_orders" ("bron", "besteld_op");

/* ────────────────── 2. Mailgedrag (Spotler, Resend) ────────────────────── */

-- Geaggregeerd per adres, niet per bericht: we willen weten óf iemand onze mail
-- leest, niet welke. Dat scheelt miljoenen rijen en het is precies wat een
-- doelgroep nodig heeft ("opent al een jaar niets" is een eigen campagne).
CREATE TABLE IF NOT EXISTS "mail_engagement" (
  "email" text PRIMARY KEY,
  "bron" text DEFAULT 'spotler' NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "verstuurd" integer DEFAULT 0 NOT NULL,
  "geopend" integer DEFAULT 0 NOT NULL,
  "geklikt" integer DEFAULT 0 NOT NULL,
  "gebounced" integer DEFAULT 0 NOT NULL,
  "afgemeld" boolean DEFAULT false NOT NULL,
  "laatst_verstuurd" timestamp with time zone,
  "laatst_geopend" timestamp with time zone,
  "laatst_geklikt" timestamp with time zone,
  "bijgewerkt_op" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "mail_engagement_klant_idx" ON "mail_engagement" ("customer_id");

/* ──────────────────── 3. Externe retouren (Returnista) ─────────────────── */

CREATE TABLE IF NOT EXISTS "externe_retouren" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bron" text DEFAULT 'returnista' NOT NULL,
  "extern_id" text NOT NULL,
  "order_ref" text DEFAULT '' NOT NULL,
  "email" text DEFAULT '' NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "status" text DEFAULT '' NOT NULL,
  -- DE reden is het hele punt: "te klein" vraagt om maatadvies, "voldeed niet
  -- aan verwachting" om betere foto's. Zonder reden is een retour alleen kosten.
  "reden" text DEFAULT '' NOT NULL,
  "bedrag_cents" integer DEFAULT 0 NOT NULL,
  "regels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "aangemeld_op" timestamp with time zone,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "opgehaald_op" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "externe_retouren_uniek" ON "externe_retouren" ("bron", "extern_id");
CREATE INDEX IF NOT EXISTS "externe_retouren_klant_idx" ON "externe_retouren" ("customer_id");
CREATE INDEX IF NOT EXISTS "externe_retouren_email_idx" ON "externe_retouren" (lower("email"));

/* ───────────────── 4. Betaalmethode vastleggen op de order ─────────────── */

-- Stond nergens: `payment_status` is alleen 'paid'. Welke methode iemand koos
-- (iDEAL, creditcard, Klarna, Bancontact) is een sterk profielkenmerk én
-- stuurt de betaalkeuze-volgorde in de checkout. Vanaf nu vastgelegd; voor de
-- historie blijft dit leeg, en dat is eerlijker dan een gok.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "betaalmethode" text DEFAULT '' NOT NULL;
CREATE INDEX IF NOT EXISTS "orders_betaalmethode_idx" ON "orders" ("betaalmethode");

/* ──────────────────── 5. Rijkere kenmerken op het profiel ──────────────── */

-- Grote maten: Kevin wil deze groep expliciet kunnen benaderen. Afgeleid uit
-- lidmaatschap van de collectie 'Grote maten' én uit de gekochte maten zelf —
-- twee wegen, want de collectie dekt niet alles en de maat niet elke categorie.
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "grote_maten" boolean DEFAULT false NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "maatprofiel_compleet" boolean DEFAULT false NOT NULL;

-- Prijsgevoeligheid als PERCENTAGE van de orders met korting. Een klant die
-- alleen in de sale koopt is een andere campagne dan iemand die vol tarief
-- betaalt — en je wilt die tweede groep nooit een kortingsmail sturen.
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "kortingsaandeel" integer DEFAULT 0 NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "orders_met_korting" integer DEFAULT 0 NOT NULL;

ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "zakelijk" boolean DEFAULT false NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "cadeaukoper" boolean DEFAULT false NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "taal" text DEFAULT 'nl' NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "betaalmethode" text DEFAULT '' NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "bezorgvoorkeur" text DEFAULT '' NOT NULL;
-- In welke maanden koopt deze klant? Voedt seizoenscampagnes: wie elk jaar in
-- mei een pak koopt (trouwseizoen) benader je in april, niet in november.
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "aankoopmaanden" jsonb DEFAULT '[]'::jsonb NOT NULL;

-- Mailgedrag
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "mail_verstuurd" integer DEFAULT 0 NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "mail_geopend" integer DEFAULT 0 NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "mail_geklikt" integer DEFAULT 0 NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "mail_openratio" integer DEFAULT 0 NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "mail_laatst_geopend" timestamp with time zone;

-- Externe kanalen, apart geteld. "Koopt bij ons én op Bol" is een eigen groep:
-- die klant kun je met een reden naar het eigen kanaal halen (marge).
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "orders_bol" integer DEFAULT 0 NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "besteed_bol_cents" integer DEFAULT 0 NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "orders_shopify" integer DEFAULT 0 NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "besteed_shopify_cents" integer DEFAULT 0 NOT NULL;

-- Retourredenen als [{waarde, aantal}] — het verschil tussen "koopt drie maten
-- en houdt er één" en "product viel tegen".
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "retour_redenen" jsonb DEFAULT '[]'::jsonb NOT NULL;

CREATE INDEX IF NOT EXISTS "customer_profiles_grote_maten_idx" ON "customer_profiles" ("grote_maten");
CREATE INDEX IF NOT EXISTS "customer_profiles_korting_idx" ON "customer_profiles" ("kortingsaandeel");
CREATE INDEX IF NOT EXISTS "customer_profiles_mail_idx" ON "customer_profiles" ("mail_openratio");
