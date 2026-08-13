-- Logboek van met de hand toegekende punten (coulance na een klacht).
--
-- Waarom een eigen tabel en niet gewoon de reden in loyalty_events: die reden
-- staat in het puntenoverzicht van de KLANT. Een interne notitie ("belde
-- boos, derde keer") hoort daar niet te staan. Het grootboek krijgt dus een
-- neutrale klanttekst, en de echte reden + wie het deed staan hier.
--
-- Dit is ook de enige plek waar te zien is of iemand structureel punten
-- weggeeft: zonder logboek is een medewerker die elke dag 500 punten uitdeelt
-- niet te onderscheiden van een tevreden klantenbestand.
CREATE TABLE IF NOT EXISTS "loyalty_service_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "points" integer NOT NULL,
  -- De interne reden. NIET zichtbaar voor de klant.
  "reason" text NOT NULL DEFAULT '',
  -- Wie het deed (portal-gebruiker). Leeg mag niet: de API weigert dat.
  "actor" text NOT NULL DEFAULT '',
  -- Optioneel het helpdesk-ticket waar het uit voortkwam.
  "ticket_id" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "loyalty_service_grants_customer_idx"
  ON "loyalty_service_grants" ("customer_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "loyalty_service_grants_actor_idx"
  ON "loyalty_service_grants" ("actor", "created_at" DESC);
