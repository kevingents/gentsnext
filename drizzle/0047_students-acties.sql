-- Students-acties: verenigingskorting aan de kassa (Kevin/Remy, 6 aug 2026).
--
-- Remy maakt in de portal een actie met een vereniging, één of alle winkels, de
-- deelnemende producten (of alles) en een kortingspercentage. De winkel kiest de
-- actie aan de kassa; alleen de deelnemende regels krijgen korting. Een klant is
-- verplicht en wordt aan de vereniging gekoppeld, zodat Remy per vereniging ziet
-- wie wat kocht.

CREATE TABLE IF NOT EXISTS "student_acties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "naam" text NOT NULL,
  "vereniging" text NOT NULL,
  -- Lege lijst = alle winkels / alle producten.
  "winkels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "producten" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "korting_pct" integer DEFAULT 0 NOT NULL,
  "vanaf" date,
  "tot" date,
  "actief" boolean DEFAULT true NOT NULL,
  "aangemaakt_door" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "student_acties_actief_idx" ON "student_acties" ("actief");
CREATE INDEX IF NOT EXISTS "student_acties_vereniging_idx" ON "student_acties" ("vereniging");

CREATE TABLE IF NOT EXISTS "student_actie_verkopen" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actie_id" uuid NOT NULL,
  -- Snapshot: een actie kan later hernoemd worden, de historie moet kloppen.
  "actie_naam" text DEFAULT '' NOT NULL,
  "vereniging" text DEFAULT '' NOT NULL,
  "store" text NOT NULL,
  "sale_id" text DEFAULT '' NOT NULL,
  "klant_naam" text DEFAULT '' NOT NULL,
  "klant_email" text DEFAULT '' NOT NULL,
  "klant_id" text DEFAULT '' NOT NULL,
  "regels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "korting_cent" integer DEFAULT 0 NOT NULL,
  "omzet_cent" integer DEFAULT 0 NOT NULL,
  "kassier" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Eén registratie per bon: een herhaalde melding mag niet dubbel tellen.
CREATE UNIQUE INDEX IF NOT EXISTS "student_verkopen_sale_uq" ON "student_actie_verkopen" ("sale_id");
CREATE INDEX IF NOT EXISTS "student_verkopen_actie_idx" ON "student_actie_verkopen" ("actie_id");
CREATE INDEX IF NOT EXISTS "student_verkopen_vereniging_idx" ON "student_actie_verkopen" ("vereniging");

CREATE TABLE IF NOT EXISTS "student_leden" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "klant_email" text NOT NULL,
  "klant_naam" text DEFAULT '' NOT NULL,
  "klant_id" text DEFAULT '' NOT NULL,
  "vereniging" text NOT NULL,
  "bron_actie_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "student_leden_email_uq" ON "student_leden" ("klant_email");
CREATE INDEX IF NOT EXISTS "student_leden_vereniging_idx" ON "student_leden" ("vereniging");
