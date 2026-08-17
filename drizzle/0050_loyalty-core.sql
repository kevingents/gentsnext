-- Loyalty-core: kassa-spaarpunten van blob naar Neon (aug 2026).
--
-- Vervangt de storegents-blob admin/loyalty-core.json. Dat was de belangrijkste
-- GELD-store die nog op blob draaide: saldo + mutatiehistorie van alle klanten,
-- met twee structurele gebreken die hier verdwijnen:
--   1. MAX_MUTATIONS=500 per account — oudere historie werd stilletjes afgekapt
--      (en een terugdraai van een oude bon vond dan geen mutaties meer).
--   2. mutateJsonBlob = last-writer-wins na 5 retries — twee gelijktijdige
--      boekingen konden elkaars punten overschrijven.
--
-- Ontwerp (zie ook db/schema.ts en lib/loyalty-core.ts):
--   * loyalty_accounts:  gematerialiseerd saldo per kassa-klant-id (TEXT: het
--     SRS-klantnummer of een gents.nl-uuid — zoals storegents 'm aanlevert).
--     Geen FK naar customers: de kassa kent klanten zonder gents.nl-account.
--   * loyalty_mutations: append-only grootboek, GEEN cap. mutation_key is de
--     idempotentie-sleutel (uniek): een herhaalde bijschrijving telt nooit dubbel.
--   * Saldo-mutatie gebeurt in ÉÉN data-modifying-CTE-statement (insert ledger
--     + upsert saldo) — atomair, ook over de neon-http-driver zonder
--     multi-statement-transacties. Saldo heeft een 0-vloer (blob-pariteit),
--     dus saldo kan afwijken van SUM(ledger); de ledger blijft de audit-bron.
--   * backfilled_at maakt de eenmalige blob-backfill idempotent: de baseline
--     wordt per account maar één keer bijgeteld.
--
-- Handmatig draaien op prod-Neon VÓÓR de storegents-deploy van neon/loyalty-core
-- (de storegents-kant boekt geld-mutaties fail-closed naar deze tabellen).

CREATE TABLE IF NOT EXISTS "loyalty_accounts" (
  "customer_id" text PRIMARY KEY NOT NULL,
  "name" text DEFAULT '' NOT NULL,
  "balance" integer DEFAULT 0 NOT NULL,
  "backfilled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "loyalty_mutations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" text NOT NULL,
  "delta" integer NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "sale_id" text DEFAULT '' NOT NULL,
  "store" text DEFAULT '' NOT NULL,
  "actor" text DEFAULT '' NOT NULL,
  "mutation_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_mutations_key_uq" ON "loyalty_mutations" ("mutation_key");
CREATE INDEX IF NOT EXISTS "loyalty_mutations_customer_idx" ON "loyalty_mutations" ("customer_id");
CREATE INDEX IF NOT EXISTS "loyalty_mutations_sale_idx" ON "loyalty_mutations" ("sale_id");
