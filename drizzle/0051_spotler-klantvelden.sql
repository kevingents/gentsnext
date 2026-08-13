-- Spotler-klantvelden: verjaardag, geslacht, mobiel (Kevin, 13 aug 2026).
--
-- Deze drie staan NERGENS anders in ons klantbeeld. Een verjaardag is een
-- campagnemoment dat je precies één keer per jaar per klant hebt; een mobiel
-- nummer is een tweede matchsleutel bij Meta en Google Ads naast het
-- e-mailadres en verhoogt het matchpercentage merkbaar.
--
-- Ze landen op mail_engagement omdat die tabel al op e-mail sleutelt en al aan
-- de klant gekoppeld wordt. Een aparte "spotler_contacten"-tabel zou dezelfde
-- rij nog een keer opslaan onder een andere naam.

ALTER TABLE "mail_engagement" ADD COLUMN IF NOT EXISTS "verjaardag" date;
ALTER TABLE "mail_engagement" ADD COLUMN IF NOT EXISTS "geslacht" text DEFAULT '' NOT NULL;
ALTER TABLE "mail_engagement" ADD COLUMN IF NOT EXISTS "mobiel" text DEFAULT '' NOT NULL;
ALTER TABLE "mail_engagement" ADD COLUMN IF NOT EXISTS "taal" text DEFAULT '' NOT NULL;
ALTER TABLE "mail_engagement" ADD COLUMN IF NOT EXISTS "gezocht_op" timestamp with time zone;

-- Rollend verrijken: de cron pakt telkens de klanten die het langst geleden
-- (of nooit) bij Spotler zijn opgevraagd. Zonder deze index wordt dat bij
-- 48.000 klanten elke run een volledige scan.
CREATE INDEX IF NOT EXISTS "mail_engagement_gezocht_idx" ON "mail_engagement" ("gezocht_op");

-- Op het profiel, zodat er doelgroepen op gebouwd kunnen worden
-- ("jarig deze maand" is de meest voor de hand liggende die we niet hadden).
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "verjaardag" date;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "geboortemaand" integer;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "geslacht" text DEFAULT '' NOT NULL;

CREATE INDEX IF NOT EXISTS "customer_profiles_geboortemaand_idx" ON "customer_profiles" ("geboortemaand");
