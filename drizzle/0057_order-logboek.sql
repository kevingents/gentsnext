-- Logboek van handmatige order-acties uit de portal (13 aug 2026).
--
-- Met de hand geschreven, niet via `db:generate`: de drizzle-snapshot staat nog
-- op 0045 terwijl 0046-0056 met de hand zijn gezet, dus een generate wil hier
-- tien bestaande tabellen opnieuw aanmaken. Zie drizzle/README.md.
-- Uitvoeren: npm run db:migratie -- drizzle/0057_order-logboek.sql
--
-- WAAROM. Site → Bestellingen kan sinds deze wijziging geld bewegen: een nieuwe
-- betaallink sturen, terugbetalen, een bestelling annuleren, handmatig een
-- bestelling aanmaken. Zonder spoor is achteraf niet te zeggen wie wat wanneer
-- deed — en juist bij een terugbetaling is dat de eerste vraag. Eén regel per
-- actie, mét de portal-gebruiker die 'm deed.
--
-- Dit is een AUDIT-tabel, geen werkvoorraad: alleen invoegen, nooit bijwerken.
-- `meta` is bewust vrij (jsonb) zodat een nieuwe actie geen migratie vraagt;
-- de vaste kolommen zijn wat je in een overzicht wilt filteren of optellen.
--
-- NIET klantzichtbaar. Dezelfde les als loyalty_events.reason, dat wél in het
-- klantprofiel opduikt: wat een medewerker als toelichting typt ("klant belde
-- boos over ...") hoort in een intern logboek, niet in een klantscherm.

CREATE TABLE IF NOT EXISTS "order_logboek" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Order-id én -nummer: het id voor de koppeling, het nummer omdat het
  -- logboek ook leesbaar moet blijven als een order ooit opgeruimd wordt.
  "order_id"     uuid,
  "order_number" text NOT NULL,
  -- 'aangemaakt' | 'betaallink' | 'terugbetaald' | 'betaalstatus' |
  -- 'geannuleerd' | 'bevestiging' | 'status'
  "actie"        text NOT NULL,
  -- Wie: portal-gebruiker (naam of e-mail). Leeg = via de API/token.
  "actor"        text DEFAULT '' NOT NULL,
  -- Vrije toelichting, intern.
  "notitie"      text DEFAULT '' NOT NULL,
  -- Bedrag waar de actie over ging (terugbetaling, ordertotaal). 0 = n.v.t.
  "bedrag_cents" integer DEFAULT 0 NOT NULL,
  "meta"         jsonb,
  "created_at"   timestamp with time zone DEFAULT now() NOT NULL
);

-- De enige twee leesvormen: de tijdlijn van één order, en "alle acties van de
-- laatste weken" voor het overzicht/de meting.
CREATE INDEX IF NOT EXISTS "order_logboek_order_idx"
  ON "order_logboek" ("order_number", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "order_logboek_tijd_idx"
  ON "order_logboek" ("created_at" DESC);
