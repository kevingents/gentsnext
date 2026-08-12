-- Klantprofiel 360 + doelgroepen (Kevin, 12 aug 2026).
--
-- Waarom dit nodig is: tot nu toe stond gedrag volstrekt LOS van de klant. De
-- events-tabel kende alleen een anonieme session_id, dus we konden wél zien dat
-- "iemand" drie keer naar een smoking keek, maar nooit wíe. Daardoor was elk
-- 360-profiel per definitie halfbakken en was een doelgroep op gedrag ("bekeek
-- trouwpakken, kocht niet") onmogelijk. Dit script legt de vier ontbrekende
-- lagen aan:
--
--   1. IDENTITEIT   — customer_identities: de identiteitsgrafiek. Eén klant kan
--                     meerdere sleutels hebben (device, e-mail, SRS-nummer,
--                     telefoon, wallet-pas). Dit is het enige punt waar die
--                     sleutels bij elkaar komen; alle koppelcode gaat hierdoor.
--   2. GEDRAG↔KLANT — events.customer_id + visitor_attribution. Zodra een
--                     device bekend wordt, kleuren we ook het verleden van dat
--                     device in (backfill), zodat de eerste sessie niet verloren
--                     gaat.
--   3. PROFIEL      — customer_profiles: het 360-beeld gematerialiseerd. Een
--                     doelgroep van 46k klanten mag geen 20 joins live doen;
--                     dit is de platgeslagen versie die per nacht ververst.
--   4. DOELGROEPEN  — audiences/audience_members/audience_syncs: de definitie,
--                     de leden en het uitleverlogboek per kanaal.
--
-- Handmatig draaien op productie (zie geheugen: migraties gaan hier niet
-- automatisch mee op een deploy). Alles is idempotent.

/* ───────────────────────── 1. Identiteitsgrafiek ───────────────────────── */

-- Eén rij per (soort, waarde). Uniek op (kind, value): een device of een
-- e-mailadres kan maar aan één klant hangen. Botst een nieuwe koppeling met een
-- bestaande, dan wint de bestaande en logt de code een waarschuwing — stil
-- overschrijven zou de historie van de vórige klant naar de nieuwe verplaatsen.
CREATE TABLE IF NOT EXISTS "customer_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  -- 'device' (gents-sid), 'email', 'srs', 'phone', 'wallet', 'pos' (kassa-klantid)
  "kind" text NOT NULL,
  -- Genormaliseerd: e-mail lowercase+trim, telefoon E.164, device = rauwe sid.
  "value" text NOT NULL,
  -- Hoe zeker is deze koppeling? 'zeker' = klant heeft ingelogd/afgerekend,
  -- 'afgeleid' = op e-mail gematcht zonder login. Doelgroepen die geld kosten
  -- (advertenties) mogen straks kiezen om alleen 'zeker' mee te nemen.
  "zekerheid" text DEFAULT 'zeker' NOT NULL,
  "bron" text DEFAULT '' NOT NULL,
  "first_seen" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_identities_uniek" ON "customer_identities" ("kind", "value");
CREATE INDEX IF NOT EXISTS "customer_identities_klant_idx" ON "customer_identities" ("customer_id");

/* ──────────────────── 2. Gedrag koppelen aan de klant ──────────────────── */

-- NULL = (nog) anoniem. Blijft NULL voor bezoekers die nooit bekend worden;
-- dat is geen fout maar de normale situatie voor ~95% van het verkeer.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "customer_id" uuid;
-- Waar kwam dit event vandaan: 'web' | 'pos' | 'server' | 'app'. Zonder dit veld
-- vallen kassabon-events en webshop-events in dezelfde emmer.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "bron" text DEFAULT 'web' NOT NULL;

-- CONCURRENTLY: `events` is de snelst groeiende tabel van de winkel en krijgt
-- continu inserts. Een gewone CREATE INDEX neemt een schrijf-lock voor de duur
-- van de bouw — op een levende winkel betekent dat wegvallende metingen en
-- hangende requests. De prijs is dat deze twee regels NIET in een transactie
-- mogen draaien; voer dit bestand dus statement voor statement uit (psql doet
-- dat vanzelf, drizzle-kit niet).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "events_klant_time_idx" ON "events" ("customer_id", "created_at");
-- Voor de backfill (kleur het verleden van een device in) én voor het
-- sessie-overzicht op het klantprofiel.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "events_session_time_idx" ON "events" ("session_id", "created_at");

-- Eerste én laatste aanraking per device. Bewust een aparte tabel en niet nog
-- meer kolommen op events: attributie hoort bij het DEVICE, niet bij elk los
-- event, en zo blijft de events-tabel smal (die groeit het hardst).
CREATE TABLE IF NOT EXISTS "visitor_attribution" (
  "session_id" text PRIMARY KEY,
  "first_source" text DEFAULT '' NOT NULL,
  "first_medium" text DEFAULT '' NOT NULL,
  "first_campaign" text DEFAULT '' NOT NULL,
  "first_term" text DEFAULT '' NOT NULL,
  "first_content" text DEFAULT '' NOT NULL,
  "first_referrer" text DEFAULT '' NOT NULL,
  "first_landing" text DEFAULT '' NOT NULL,
  "last_source" text DEFAULT '' NOT NULL,
  "last_medium" text DEFAULT '' NOT NULL,
  "last_campaign" text DEFAULT '' NOT NULL,
  -- Klik-id's van de advertentieplatforms. Zonder deze kan Google/Meta een
  -- offline of server-side conversie niet aan de juiste klik hangen; ze waren
  -- er tot nu toe helemaal niet, dus élke conversie was ongeattribueerd.
  "gclid" text DEFAULT '' NOT NULL,
  "gbraid" text DEFAULT '' NOT NULL,
  "wbraid" text DEFAULT '' NOT NULL,
  "fbclid" text DEFAULT '' NOT NULL,
  "ttclid" text DEFAULT '' NOT NULL,
  "msclkid" text DEFAULT '' NOT NULL,
  "first_seen" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "visitor_attribution_bron_idx" ON "visitor_attribution" ("first_source", "first_medium");

-- De aanraking die deze order opleverde, vastgevroren op het moment van
-- bestellen. Een verwijzing naar visitor_attribution zou meebewegen; een order
-- moet toegerekend blijven aan de campagne die 'm bracht.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "attributie" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "session_id" text DEFAULT '' NOT NULL;

/* ─────────────────────── 3. Het 360-profiel, plat ──────────────────────── */

CREATE TABLE IF NOT EXISTS "customer_profiles" (
  "customer_id" uuid PRIMARY KEY REFERENCES "customers"("id") ON DELETE CASCADE,

  -- Identiteit & bereikbaarheid. De _sha256-velden zijn wat we naar Meta en
  -- Google Ads sturen: die platforms matchen op een hash, nooit op het rauwe
  -- adres. Hier vooraf berekend zodat een uitlevering van 20k klanten geen
  -- 20k hashes hoeft te doen tijdens het versturen.
  "email" text DEFAULT '' NOT NULL,
  "email_sha256" text DEFAULT '' NOT NULL,
  "phone_e164" text DEFAULT '' NOT NULL,
  "phone_sha256" text DEFAULT '' NOT NULL,
  "voornaam_sha256" text DEFAULT '' NOT NULL,
  "achternaam_sha256" text DEFAULT '' NOT NULL,
  "postcode" text DEFAULT '' NOT NULL,
  "plaats" text DEFAULT '' NOT NULL,
  "land" text DEFAULT 'NL' NOT NULL,
  "srs_customer_id" text DEFAULT '' NOT NULL,

  -- Waarde. Online en winkel apart én opgeteld: het verschil is precies wat een
  -- omnichannel-doelgroep interessant maakt ("koopt alleen in de winkel, nooit
  -- online" is een andere campagne dan andersom).
  "orders_online" integer DEFAULT 0 NOT NULL,
  "orders_winkel" integer DEFAULT 0 NOT NULL,
  "orders_totaal" integer DEFAULT 0 NOT NULL,
  "besteed_online_cents" integer DEFAULT 0 NOT NULL,
  "besteed_winkel_cents" integer DEFAULT 0 NOT NULL,
  "besteed_totaal_cents" integer DEFAULT 0 NOT NULL,
  "gem_orderwaarde_cents" integer DEFAULT 0 NOT NULL,
  "eerste_aankoop" timestamp with time zone,
  "laatste_aankoop" timestamp with time zone,
  "dagen_sinds_aankoop" integer,
  -- Ruwe voorspelling van de klantwaarde over 24 maanden. Bewust simpel
  -- (frequentie × gemiddelde orderwaarde × resterende horizon) en als cent-
  -- bedrag; het doel is sorteren en segmenteren, niet boekhouden.
  "klantwaarde_cents" integer DEFAULT 0 NOT NULL,

  -- Retouren: een klant met 60% retour is een ándere doelgroep dan zijn omzet
  -- suggereert. Zonder dit veld adverteer je je verlies groter.
  "retouren" integer DEFAULT 0 NOT NULL,
  "retour_cents" integer DEFAULT 0 NOT NULL,
  "retourquote" integer DEFAULT 0 NOT NULL,

  -- Loyaliteit & tegoed
  "punten" integer DEFAULT 0 NOT NULL,
  "punten_beschikbaar" integer DEFAULT 0 NOT NULL,
  "tegoed_cents" integer DEFAULT 0 NOT NULL,
  "actieve_vouchers" integer DEFAULT 0 NOT NULL,
  "wallet_pas" boolean DEFAULT false NOT NULL,

  -- Gedrag (uit events, alleen ná analytics-toestemming vastgelegd)
  "sessies_30d" integer DEFAULT 0 NOT NULL,
  "productviews_30d" integer DEFAULT 0 NOT NULL,
  "zoekopdrachten_30d" integer DEFAULT 0 NOT NULL,
  "laatst_gezien" timestamp with time zone,
  -- Laatste keer add_to_cart zónder aankoop erna: de winkelwagen-verlaters.
  "kar_verlaten_op" timestamp with time zone,
  "laatst_bekeken" jsonb DEFAULT '[]'::jsonb NOT NULL,

  -- Service & betrokkenheid
  "tickets" integer DEFAULT 0 NOT NULL,
  "afspraken" integer DEFAULT 0 NOT NULL,
  "reviews" integer DEFAULT 0 NOT NULL,

  -- Affiniteit: waar gaat deze klant over. Gevuld uit orderregels + kassabonnen
  -- + gedrag, als [{waarde, aantal}] gesorteerd op aantal.
  "top_categorieen" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "top_merken" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "top_kleuren" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "maten" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "favoriete_winkel" text DEFAULT '' NOT NULL,
  -- 'online' | 'winkel' | 'omni' | 'geen'
  "kanaal" text DEFAULT 'geen' NOT NULL,

  -- Toestemming. Drie losse waarheden die tot nu toe door elkaar liepen:
  -- customers.marketing_opt_in, newsletter_subscribers.status en de
  -- cookie-marketingkeuze. Een doelgroep die naar een advertentieplatform gaat
  -- mag alleen op de eerste twee leunen; de derde is voor tags op de site.
  "marketing_opt_in" boolean DEFAULT false NOT NULL,
  "nieuwsbrief" text DEFAULT 'geen' NOT NULL,
  "whatsapp_opt_in" boolean DEFAULT false NOT NULL,

  -- RFM: 1–5 per as. De basis onder de meeste standaard-doelgroepen.
  "rfm_r" integer DEFAULT 0 NOT NULL,
  "rfm_f" integer DEFAULT 0 NOT NULL,
  "rfm_m" integer DEFAULT 0 NOT NULL,
  -- Afgeleid label: nieuw | trouw | vip | slapend | risico | eenmalig | verloren
  "segment" text DEFAULT 'geen' NOT NULL,

  "attributie" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "berekend_op" timestamp with time zone DEFAULT now() NOT NULL
);

-- Deze indexen dragen de doelgroep-regels. Een audience-query is in de kern een
-- WHERE over deze kolommen; zonder indexen wordt elke voorbeeldtelling een
-- volledige scan over 46k rijen.
CREATE INDEX IF NOT EXISTS "customer_profiles_segment_idx" ON "customer_profiles" ("segment");
CREATE INDEX IF NOT EXISTS "customer_profiles_kanaal_idx" ON "customer_profiles" ("kanaal");
CREATE INDEX IF NOT EXISTS "customer_profiles_besteed_idx" ON "customer_profiles" ("besteed_totaal_cents");
CREATE INDEX IF NOT EXISTS "customer_profiles_laatste_idx" ON "customer_profiles" ("laatste_aankoop");
CREATE INDEX IF NOT EXISTS "customer_profiles_optin_idx" ON "customer_profiles" ("marketing_opt_in");
CREATE INDEX IF NOT EXISTS "customer_profiles_winkel_idx" ON "customer_profiles" ("favoriete_winkel");
CREATE INDEX IF NOT EXISTS "customer_profiles_rfm_idx" ON "customer_profiles" ("rfm_r", "rfm_f", "rfm_m");

/* ───────────────────────────── 4. Doelgroepen ──────────────────────────── */

CREATE TABLE IF NOT EXISTS "audiences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "naam" text NOT NULL,
  "omschrijving" text DEFAULT '' NOT NULL,
  -- Regelboom: {op:'en'|'of', regels:[{veld, operator, waarde} | genest]}.
  -- Bewust data en geen SQL-string: de regels worden in de portal geklikt en
  -- server-side naar SQL vertaald tegen een vaste veldenlijst. Vrije SQL in een
  -- kolom is een injectie-deur die vanzelf een keer opengaat.
  "definitie" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- 'dynamisch' = elke nacht opnieuw bepaald, 'statisch' = eenmalig vastgezet.
  "soort" text DEFAULT 'dynamisch' NOT NULL,
  "actief" boolean DEFAULT true NOT NULL,
  -- Uitleverdoelen: {"resend":{...},"meta":{...},"google":{...}}.
  "kanalen" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "aantal" integer DEFAULT 0 NOT NULL,
  "aantal_bereikbaar" integer DEFAULT 0 NOT NULL,
  "laatst_gebouwd" timestamp with time zone,
  "aangemaakt_door" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "audiences_slug_uniek" ON "audiences" ("slug");
CREATE INDEX IF NOT EXISTS "audiences_actief_idx" ON "audiences" ("actief");

CREATE TABLE IF NOT EXISTS "audience_members" (
  "audience_id" uuid NOT NULL REFERENCES "audiences"("id") ON DELETE CASCADE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "toegevoegd_op" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "audience_members_pk" PRIMARY KEY ("audience_id", "customer_id")
);

CREATE INDEX IF NOT EXISTS "audience_members_klant_idx" ON "audience_members" ("customer_id");

-- Uitleverlogboek. Per kanaal per keer: hoeveel erbij, hoeveel eraf, en de
-- foutmelding als het misging. Zonder dit logboek weet je bij een scheve
-- Meta-doelgroep nooit of het aan de regel of aan de uitlevering lag.
CREATE TABLE IF NOT EXISTS "audience_syncs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "audience_id" uuid NOT NULL REFERENCES "audiences"("id") ON DELETE CASCADE,
  "kanaal" text NOT NULL,
  "status" text DEFAULT 'bezig' NOT NULL,
  "toegevoegd" integer DEFAULT 0 NOT NULL,
  "verwijderd" integer DEFAULT 0 NOT NULL,
  "overgeslagen" integer DEFAULT 0 NOT NULL,
  "fout" text DEFAULT '' NOT NULL,
  "extern_id" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "audience_syncs_audience_idx" ON "audience_syncs" ("audience_id", "created_at");

/* ───────────────── 5. Eenmalige vulling van de identiteiten ────────────── */

-- E-mail als identiteit voor elke bestaande klant, plus het SRS-nummer waar dat
-- bekend is. Hierdoor werkt het koppelen van tickets, retouren en afspraken
-- (die alleen een e-mailadres hebben) meteen, zonder op de nachtjob te wachten.
INSERT INTO "customer_identities" ("customer_id", "kind", "value", "zekerheid", "bron")
SELECT "id", 'email', lower(trim("email")), 'zeker', 'migratie'
FROM "customers"
WHERE trim("email") <> ''
ON CONFLICT ("kind", "value") DO NOTHING;

INSERT INTO "customer_identities" ("customer_id", "kind", "value", "zekerheid", "bron")
SELECT "id", 'srs', trim("srs_customer_id"), 'zeker', 'migratie'
FROM "customers"
WHERE "srs_customer_id" IS NOT NULL AND trim("srs_customer_id") <> ''
ON CONFLICT ("kind", "value") DO NOTHING;
