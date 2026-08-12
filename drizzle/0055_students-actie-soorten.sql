-- Students-acties: meer dan alleen een percentage.
--
-- Een verenigings-actie kon tot nu toe alleen "X% op de deelnemende regels".
-- Kevin wil ook een vast bedrag, 2+1 (koop N, krijg M gratis) en een cadeau uit
-- een tweede lijst — en per actie instelbaar of de actie zich binnen één bon
-- herhaalt.
--
-- Alles additief met defaults die het oude gedrag zijn: bestaande rijen krijgen
-- soort 'percent' en houden hun korting_pct. Met IF NOT EXISTS zodat het handmatig
-- op productie draaien en dit bestand later opnieuw toepassen niet botst.

ALTER TABLE "student_acties" ADD COLUMN IF NOT EXISTS "korting_soort" text NOT NULL DEFAULT 'percent';
ALTER TABLE "student_acties" ADD COLUMN IF NOT EXISTS "korting_cent" integer NOT NULL DEFAULT 0;
ALTER TABLE "student_acties" ADD COLUMN IF NOT EXISTS "koop_aantal" integer NOT NULL DEFAULT 0;
ALTER TABLE "student_acties" ADD COLUMN IF NOT EXISTS "gratis_aantal" integer NOT NULL DEFAULT 0;
ALTER TABLE "student_acties" ADD COLUMN IF NOT EXISTS "herhalen" boolean NOT NULL DEFAULT true;
ALTER TABLE "student_acties" ADD COLUMN IF NOT EXISTS "cadeau_producten" jsonb NOT NULL DEFAULT '[]'::jsonb;
