-- Exact Online-koppelingsstatus: van Vercel Blob naar Neon (12 aug 2026).
--
-- Kleine key/value-tabel voor de versleutelde OAuth-tokens (storegents
-- versleutelt vóór het schrijven; de database ziet nooit een leesbare token),
-- de boekhoud-mapping en de geboekt-markers van dagstaten en Mollie-
-- uitbetalingen.
--
-- Waarom weg uit blob: blob is uiteindelijk-consistent en kent geen sloten.
-- In 24 uur testen gaf dat drie incidenten — een "al geboekt"-weigering direct
-- na het terugdraaien, een boeking die de nét oude mapping las, en de ergste:
-- Exacts refresh-token is eenmalig, en twee servers die tegelijk verversten
-- kostten de hele koppeling ("Old refresh token used", herverbinden was de
-- enige uitweg). In Postgres is lezen altijd vers en is de refresh-claim één
-- atomaire INSERT ... ON CONFLICT ... WHERE.
--
-- Handmatig draaien (het drizzle-journaal stopt bewust bij 0045):
--   node -e "…"  met DATABASE_URL uit .env.local — zie drizzle/README.md.

CREATE TABLE IF NOT EXISTS "exact_state" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
