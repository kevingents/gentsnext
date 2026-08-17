-- Klik- en scroll-heatmap van de storefront (13 aug 2026).
--
-- Met de hand geschreven, niet via `db:generate`: de drizzle-snapshot staat nog
-- op 0045 terwijl 0046–0055 met de hand zijn gezet, dus een generate wil hier
-- tien bestaande tabellen (customer_profiles, audiences, pos_*, student_*, …)
-- opnieuw aanmaken. Zie drizzle/README.md en scripts/migratie-uitvoeren.ts.
-- Uitvoeren: npm run db:migratie -- drizzle/0056_heatmap.sql
--
-- TWEE LAGEN. `heatmap_klikken` en `heatmap_scroll` zijn het ruwe materiaal,
-- mét sessie-id, met een bewaartermijn (Instellingen → heatmap.bewaardagen,
-- standaard 45 dagen). De drie dag-tabellen zijn optellingen zónder sessie-id
-- en blijven ruim 13 maanden staan. De nachtelijke cron
-- /api/cron/heatmap-rollup vult de tweede laag en ruimt de eerste op.
--
-- GEEN customer_id, nergens. Een heatmap beantwoordt "waar klikt men", niet
-- "waar klikte deze klant" — dat tweede is een sessie-opname en die bouwen we
-- bewust niet.
--
-- Volume-inschatting: ~20 kliks per paginaweergave op de gemeten pagina's. De
-- indexen staan op (pagina_key, apparaat, created_at) omdat élke uitleesquery
-- precies zo filtert, en los op created_at voor de nachtelijke opruiming.

CREATE TABLE IF NOT EXISTS "heatmap_klikken" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Paginasjabloon, bv. '/products/[handle]' (lib/heatmap-paginas).
  "pagina_key"      text NOT NULL,
  -- De echte URL — alleen om de viewer een bestaande pagina te laten openen.
  "pad"             text DEFAULT '' NOT NULL,
  "apparaat"        text NOT NULL,
  "session_id"      text DEFAULT '' NOT NULL,
  -- x in promille van de vensterbreedte (0–1000), y in CSS-pixels vanaf de
  -- bovenkant van het document.
  "x"               integer NOT NULL,
  "y"               integer NOT NULL,
  -- Positie binnen het geraakte element, promille — overleeft herindeling.
  "ox"              integer DEFAULT 0 NOT NULL,
  "oy"              integer DEFAULT 0 NOT NULL,
  "selector"        text DEFAULT '' NOT NULL,
  "label"           text DEFAULT '' NOT NULL,
  -- 'klik' | 'dood' (niets klikbaars geraakt) | 'woede' (herhaald rammen).
  "soort"           text DEFAULT 'klik' NOT NULL,
  "doc_hoogte"      integer DEFAULT 0 NOT NULL,
  "venster_breedte" integer DEFAULT 0 NOT NULL,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "heatmap_klik_pagina_idx"
  ON "heatmap_klikken" ("pagina_key", "apparaat", "created_at");

CREATE INDEX IF NOT EXISTS "heatmap_klik_tijd_idx"
  ON "heatmap_klikken" ("created_at");

-- Eén rij per paginaweergave: hoe diep is de bezoeker gekomen.
CREATE TABLE IF NOT EXISTS "heatmap_scroll" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pagina_key"      text NOT NULL,
  "apparaat"        text NOT NULL,
  "session_id"      text DEFAULT '' NOT NULL,
  "max_pct"         integer DEFAULT 0 NOT NULL,
  "doc_hoogte"      integer DEFAULT 0 NOT NULL,
  "venster_hoogte"  integer DEFAULT 0 NOT NULL,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "heatmap_scroll_pagina_idx"
  ON "heatmap_scroll" ("pagina_key", "apparaat", "created_at");

CREATE INDEX IF NOT EXISTS "heatmap_scroll_tijd_idx"
  ON "heatmap_scroll" ("created_at");

-- Dagtotalen: kliks per rastercel. 50 kolommen breed (x-promille / 20), rijen
-- van 20 CSS-pixels hoog. De primaire sleutel is meteen de upsert-sleutel van
-- de rollup, zodat een dag opnieuw oprollen niets dubbeltelt.
CREATE TABLE IF NOT EXISTS "heatmap_cellen" (
  "pagina_key" text    NOT NULL,
  "apparaat"   text    NOT NULL,
  "dag"        date    NOT NULL,
  "cx"         integer NOT NULL,
  "cy"         integer NOT NULL,
  "n"          integer DEFAULT 0 NOT NULL,
  "doden"      integer DEFAULT 0 NOT NULL,
  "woede"      integer DEFAULT 0 NOT NULL,
  CONSTRAINT "heatmap_cellen_pagina_key_apparaat_dag_cx_cy_pk"
    PRIMARY KEY ("pagina_key", "apparaat", "dag", "cx", "cy")
);

CREATE INDEX IF NOT EXISTS "heatmap_cellen_dag_idx" ON "heatmap_cellen" ("dag");

-- Dagtotalen: kliks per element. Voedt de lijst "waarop wordt geklikt", inclusief
-- het aandeel dode kliks per element.
CREATE TABLE IF NOT EXISTS "heatmap_elementen" (
  "pagina_key" text    NOT NULL,
  "apparaat"   text    NOT NULL,
  "dag"        date    NOT NULL,
  "selector"   text    NOT NULL,
  "label"      text    DEFAULT '' NOT NULL,
  "n"          integer DEFAULT 0 NOT NULL,
  "doden"      integer DEFAULT 0 NOT NULL,
  "woede"      integer DEFAULT 0 NOT NULL,
  CONSTRAINT "heatmap_elementen_pagina_key_apparaat_dag_selector_pk"
    PRIMARY KEY ("pagina_key", "apparaat", "dag", "selector")
);

CREATE INDEX IF NOT EXISTS "heatmap_elementen_dag_idx" ON "heatmap_elementen" ("dag");

-- Dagtotalen: scrollbereik, één rij per drempel van 5%. `weergaven` telt de
-- paginaweergaven die die drempel HAALDEN, dus bucket 0 is het totaal. Rijen in
-- plaats van een jsonb-verdeling, omdat dagen optellen dan een gewone
-- `sum(...) group by bucket` is.
CREATE TABLE IF NOT EXISTS "heatmap_scroll_dag" (
  "pagina_key" text    NOT NULL,
  "apparaat"   text    NOT NULL,
  "dag"        date    NOT NULL,
  "bucket"     integer NOT NULL,
  "weergaven"  integer DEFAULT 0 NOT NULL,
  CONSTRAINT "heatmap_scroll_dag_pagina_key_apparaat_dag_bucket_pk"
    PRIMARY KEY ("pagina_key", "apparaat", "dag", "bucket")
);

CREATE INDEX IF NOT EXISTS "heatmap_scroll_dag_dag_idx" ON "heatmap_scroll_dag" ("dag");
