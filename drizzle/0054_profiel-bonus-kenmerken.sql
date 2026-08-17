-- Drie kenmerken in het 360-profiel die uit de puntenbonussen komen, zodat je
-- er doelgroepen op kunt maken ("klanten zonder maatprofiel" is precies de
-- groep die de meeste retouren veroorzaakt).
--
-- `maten` bestond al, maar dat zijn de maten die iemand GEKOCHT heeft — afgeleid
-- uit orderregels. `maatprofiel` is wat de klant ZELF heeft opgegeven, en dat is
-- het veld waarop je hem kunt aanschrijven.
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "maatprofiel" boolean NOT NULL DEFAULT false;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "profiel_compleet" boolean NOT NULL DEFAULT false;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "bonus_punten" integer NOT NULL DEFAULT 0;

-- Doelgroepen filteren op "heeft dit nog niet"; dat zijn de grote groepen, dus
-- een index op de vlaggen zelf helpt weinig. Deze twee dekken de combinatie die
-- de campagnes gebruiken: bereikbare klanten zonder maatprofiel/compleet profiel.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_profiles_maatprofiel_idx"
  ON "customer_profiles" ("maatprofiel", "marketing_opt_in");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_profiles_compleet_idx"
  ON "customer_profiles" ("profiel_compleet", "marketing_opt_in");
