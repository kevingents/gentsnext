-- Spiegel van het SRS-personeelsbestand voor de snelle kassacode-check
-- (login + kassacode-bevestiging in storegents). Kassacode alleen als
-- sha256(personnelId:code)-hash, nooit plaintext. Zie db/schema.ts
-- (personnelMirror) voor het waarom en de vulling.
CREATE TABLE IF NOT EXISTS "personnel_mirror" (
  "personnel_id" text PRIMARY KEY NOT NULL,
  "name" text DEFAULT '' NOT NULL,
  "internal_name" text DEFAULT '' NOT NULL,
  "external_name" text DEFAULT '' NOT NULL,
  "personnel_group_id" text DEFAULT '' NOT NULL,
  "active" boolean DEFAULT false NOT NULL,
  "branches" text DEFAULT '' NOT NULL,
  "fingerprint_required" boolean DEFAULT false NOT NULL,
  "code_hash" text DEFAULT '' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
