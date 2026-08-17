-- E-mailflows (journeys) — Kevin, 13 aug 2026.
--
-- Wat we hadden: 16 transactionele mails die elk vanuit hun eigen codepad
-- afgaan, één geplande mail (verjaardag), en doelgroepen. Dus WIE en WAT, maar
-- niet WANNEER, in welke VOLGORDE, en wanneer iemand er weer UIT stapt.
--
-- Dat laatste is het hele punt van een journey. "Je vergat iets in je
-- winkelwagen" twee dagen ná de aankoop versturen is erger dan niets sturen:
-- de klant ziet dat je niet weet wat hij deed. Daarom zijn UITSTAPREGELS hier
-- geen extra maar de kern.
--
-- Drie tabellen:
--   email_flows          de definitie (trigger + stappen + uitstapregels)
--   email_flow_leden     waar staat DEZE klant, en wanneer is de volgende stap
--   email_flow_stappen   wat is er daadwerkelijk verstuurd (idempotentie + log)

CREATE TABLE IF NOT EXISTS "email_flows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "naam" text NOT NULL,
  "omschrijving" text DEFAULT '' NOT NULL,

  -- Wanneer stapt iemand IN. 'doelgroep' = zodra hij in de doelgroep valt,
  -- 'gebeurtenis' = op een event (kar verlaten, eerste aankoop, verjaardag).
  "trigger_soort" text NOT NULL,
  "trigger_doelgroep_id" uuid REFERENCES "audiences"("id") ON DELETE SET NULL,
  "trigger_event" text DEFAULT '' NOT NULL,

  -- De stappen: [{soort:'wacht', uren:4}, {soort:'mail', sjabloon:'kar-1'},
  --              {soort:'voorwaarde', veld:'orders_totaal', ...}]
  "stappen" jsonb DEFAULT '[]'::jsonb NOT NULL,

  -- UITSTAPREGELS. Zelfde regelboom als de doelgroepen. Klopt er één, dan
  -- verlaat de klant de flow vóór de volgende stap — dus geen "je vergat iets"
  -- nadat hij kocht.
  "uitstap" jsonb DEFAULT '{}'::jsonb NOT NULL,

  -- Mag iemand hier opnieuw in? Winkelwagen-verlaten: ja, maar niet vaker dan
  -- eens per X dagen. Welkomstflow: nooit.
  "herhaalbaar" boolean DEFAULT false NOT NULL,
  "herhaal_na_dagen" integer DEFAULT 90 NOT NULL,

  "actief" boolean DEFAULT false NOT NULL,
  "aangemaakt_door" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_flows_slug_uniek" ON "email_flows" ("slug");
CREATE INDEX IF NOT EXISTS "email_flows_actief_idx" ON "email_flows" ("actief");

CREATE TABLE IF NOT EXISTS "email_flow_leden" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "flow_id" uuid NOT NULL REFERENCES "email_flows"("id") ON DELETE CASCADE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "stap" integer DEFAULT 0 NOT NULL,
  -- 'loopt' | 'klaar' | 'uitgestapt' | 'gestopt'
  "status" text DEFAULT 'loopt' NOT NULL,
  -- Wanneer de volgende stap aan de beurt is. De loper pakt alles waarvan dit
  -- moment voorbij is; dat is meteen de wachtstap-implementatie.
  "volgende_stap_op" timestamp with time zone DEFAULT now() NOT NULL,
  "reden_uitstap" text DEFAULT '' NOT NULL,
  "ingestapt_op" timestamp with time zone DEFAULT now() NOT NULL,
  "afgerond_op" timestamp with time zone
);

-- Eén actieve doorloop per klant per flow. Zonder deze index kan een klant bij
-- twee gelijktijdige triggers twee keer in dezelfde flow zitten en alles dubbel
-- krijgen.
CREATE UNIQUE INDEX IF NOT EXISTS "email_flow_leden_actief_uniek"
  ON "email_flow_leden" ("flow_id", "customer_id") WHERE "status" = 'loopt';
CREATE INDEX IF NOT EXISTS "email_flow_leden_due_idx" ON "email_flow_leden" ("status", "volgende_stap_op");
CREATE INDEX IF NOT EXISTS "email_flow_leden_klant_idx" ON "email_flow_leden" ("customer_id");

CREATE TABLE IF NOT EXISTS "email_flow_stappen" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "lid_id" uuid NOT NULL REFERENCES "email_flow_leden"("id") ON DELETE CASCADE,
  "flow_id" uuid NOT NULL REFERENCES "email_flows"("id") ON DELETE CASCADE,
  "customer_id" uuid NOT NULL,
  "stap" integer NOT NULL,
  "soort" text NOT NULL,
  "sjabloon" text DEFAULT '' NOT NULL,
  "gelukt" boolean DEFAULT true NOT NULL,
  "fout" text DEFAULT '' NOT NULL,
  "uitgevoerd_op" timestamp with time zone DEFAULT now() NOT NULL
);

-- Idempotentie: dezelfde stap voor dezelfde doorloop kan maar één keer. Draait
-- de loper twee keer, of start hij halverwege opnieuw, dan gaat er niets dubbel.
CREATE UNIQUE INDEX IF NOT EXISTS "email_flow_stappen_uniek" ON "email_flow_stappen" ("lid_id", "stap");
CREATE INDEX IF NOT EXISTS "email_flow_stappen_klant_idx" ON "email_flow_stappen" ("customer_id", "uitgevoerd_op");
