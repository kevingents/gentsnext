-- Wie heeft er nooit welkomstpunten gehad?
--
-- De welkomstbonus (50 punten bij het aanmaken van een profiel) geldt alleen
-- vooruit. Alle klanten van vóór 13 aug 2026 hebben 'm dus niet — dat zijn er
-- ruim 48.000, en die met terugwerkende kracht uitbetalen is ongeveer € 120.000.
--
-- Dat besluit hoeft niet nu genomen te worden, maar de GROEP moet wel te
-- benaderen zijn: als doelgroep kun je ze een reden geven om iets te doen
-- (profiel afmaken, maten opgeven) in plaats van ze stilzwijgend punten te
-- geven waar niemand iets voor terugdoet.
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "welkomstbonus" boolean NOT NULL DEFAULT false;

-- De doelgroep filtert op "nee" gecombineerd met bereikbaarheid; dat is precies
-- deze index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_profiles_welkomstbonus_idx"
  ON "customer_profiles" ("welkomstbonus", "marketing_opt_in");
