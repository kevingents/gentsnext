-- Klantvoorkeuren in het 360-profiel (Kevin, 13 aug 2026).
--
-- De klant vult op /account bij Voorkeuren zijn geboortedatum, leeftijdsgroep,
-- favoriete kleuren, vaste winkel en gelegenheden in. Die stonden in
-- customers.preferences en werden ALLEEN gebruikt voor het vinkje "profiel
-- compleet" — verder ging er niets mee. Het scherm belooft ondertussen "hoe
-- beter dit staat, hoe gerichter we laten zien wat er in jouw maat, kleur en
-- winkel ligt", en dat maakten we nergens waar.
--
-- Nu als velden op het profiel, zodat er doelgroepen op te bouwen zijn.
-- De verjaardag stond er al (0051) maar werd uit Spotler gevuld; de klant is
-- zelf de betere bron — die weet het en houdt het bij.

ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "leeftijdsgroep" text DEFAULT '' NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "favoriete_kleuren" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "gelegenheden" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "vaste_winkel" text DEFAULT '' NOT NULL;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "profiel_compleet" boolean DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS "customer_profiles_leeftijd_idx" ON "customer_profiles" ("leeftijdsgroep");
CREATE INDEX IF NOT EXISTS "customer_profiles_vaste_winkel_idx" ON "customer_profiles" ("vaste_winkel");

-- Verjaardagsmail: één keer per jaar per klant, ook als de cron twee keer
-- draait of een dag overslaat. Zonder deze tabel is "al gefeliciteerd?" niet te
-- beantwoorden en stuur je bij een herstart de hele lijst opnieuw.
CREATE TABLE IF NOT EXISTS "verjaardag_mails" (
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "jaar" integer NOT NULL,
  "verstuurd_op" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "verjaardag_mails_pk" PRIMARY KEY ("customer_id", "jaar")
);
