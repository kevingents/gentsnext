-- StorePos-PLU-catalogus (21-8-2026): staging voor de reserve-import nu SRS'
-- eigen product-export (get_product_info) stuk is. Eén kassa-pc uploadt
-- dagelijks de artikel-tabel uit z'n lokale StorePos-Postgres (±178k rijen,
-- zelfde bron als StorePos zelf); de aanmaak van ontbrekende artikelen loopt
-- daarna door dezelfde kern als de SRS-import (lib/srs-artikelen maakUitRijen).
CREATE TABLE IF NOT EXISTS plu_catalog (
  barcode           text PRIMARY KEY,
  art_id            text NOT NULL DEFAULT '',
  art_nr            text NOT NULL DEFAULT '',
  oms               text NOT NULL DEFAULT '',
  hoofdgroep        text NOT NULL DEFAULT '',
  label1            text NOT NULL DEFAULT '',
  label2            text NOT NULL DEFAULT '',
  label3            text NOT NULL DEFAULT '',
  leverancier_nr    text NOT NULL DEFAULT '',
  size_oms          text NOT NULL DEFAULT '',
  maatbalk          text NOT NULL DEFAULT '',
  maatnr            integer,
  klr_id            text NOT NULL DEFAULT '',
  btwcode           text NOT NULL DEFAULT '',
  prijs_cents       integer NOT NULL DEFAULT 0,
  kostprijs_cents   integer NOT NULL DEFAULT 0,
  adviesprijs_cents integer NOT NULL DEFAULT 0,
  dropship          boolean NOT NULL DEFAULT false,
  seen_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plu_catalog_art_idx ON plu_catalog (art_nr, klr_id);
