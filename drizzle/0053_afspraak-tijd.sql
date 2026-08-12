-- Afspraken: het afgesproken tijdstip ("14:30"). De klant kiest online alleen
-- een dagdeel; de winkel legt bij het bevestigen het exacte tijdstip vast en
-- de klant krijgt dan pas de definitieve bevestiging. Leeg = nog niet bevestigd.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "tijd" text NOT NULL DEFAULT '';
