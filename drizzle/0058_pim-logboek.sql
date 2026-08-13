-- Logboek van handmatige productwijzigingen uit de portal — het PIM (13 aug 2026).
--
-- Met de hand geschreven, niet via `db:generate`: de drizzle-snapshot staat nog
-- op 0045 terwijl 0046-0057 met de hand zijn gezet, dus een generate wil hier
-- elf bestaande tabellen opnieuw aanmaken. Zie drizzle/README.md.
-- Uitvoeren: npm run db:migratie -- drizzle/0058_pim-logboek.sql
--
-- WAAROM. Tot nu toe was het productscherm alleen kijken; de catalogus kwam uit
-- SRS en die overschreef je niet. Met het PIM kan een medewerker de titel, het
-- merk, het type, de status en de metavelden van een artikel wél zetten. Dat is
-- precies het moment waarop je een spoor nodig hebt: "wie heeft dit artikel op
-- draft gezet en waarom staat het niet meer op de site" is anders onbeantwoordbaar.
--
-- Eén regel per gewijzigd VELD, niet per opslag-actie. Dat is bewust: de vraag
-- die je later stelt is altijd "wie heeft dít veld veranderd", en een regel per
-- formulier-post dwingt je dan om jsonb te doorzoeken.
--
-- Dit is een AUDIT-tabel, geen werkvoorraad: alleen invoegen, nooit bijwerken.
--
-- NIET klantzichtbaar (zelfde les als loyalty_events.reason, dat wél in het
-- klantprofiel opdook): `actor` is een medewerkersnaam.

CREATE TABLE IF NOT EXISTS "product_wijzigingen" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Id én handle: het id voor de koppeling, de handle omdat het logboek
  -- leesbaar moet blijven als een artikel ooit uit de catalogus verdwijnt.
  "product_id" uuid,
  "handle"     text NOT NULL,
  -- Welk veld: een kolomnaam uit PIM_VELDEN ('title', 'status', ...), een
  -- metaveld als 'attr:pasvorm', of een laag-sleutel ('override:descriptionHtml',
  -- 'seo:title'). Zie lib/pim.ts — daar staat de enige lijst.
  "veld"       text NOT NULL,
  -- 'bewerkt' | 'vergrendeld' | 'ontgrendeld' | 'bulk'
  "actie"      text NOT NULL DEFAULT 'bewerkt',
  -- De waarden als tekst. Afgekapt op 2000 tekens: een omschrijving van 8kB
  -- tweemaal per wijziging bewaren maakt deze tabel groter dan de catalogus.
  "oude_waarde" text NOT NULL DEFAULT '',
  "nieuwe_waarde" text NOT NULL DEFAULT '',
  -- Wie: portal-gebruiker (naam of e-mail). Leeg = via de API/token.
  "actor"      text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- De twee leesvormen: de tijdlijn van één artikel (het scherm), en "alles van
-- de laatste weken" voor het overzicht.
CREATE INDEX IF NOT EXISTS "product_wijzigingen_handle_idx"
  ON "product_wijzigingen" ("handle", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "product_wijzigingen_tijd_idx"
  ON "product_wijzigingen" ("created_at" DESC);

-- Het slot zelf: handmatige_velden bestond al als kolom, maar werd nergens
-- gelezen. Een index erop is nodig zodra het kwaliteitsoverzicht "hoeveel
-- artikelen zijn met de hand verrijkt" over de hele catalogus telt.
CREATE INDEX IF NOT EXISTS "products_handmatig_idx"
  ON "products" USING gin ("handmatige_velden");

-- Het slot voor METAVELDEN, als functie.
--
-- De kolomvelden (title, vendor, ...) kan de import met een simpele CASE
-- beschermen. Metavelden niet: die zitten als losse sleutels in één jsonb-kolom,
-- dus je moet de vergrendelde sleutels eruit vissen en ná de import-waarde
-- terugleggen. Dat vraagt een aggregatie over jsonb_object_keys, en die past
-- niet in een ON CONFLICT ... DO UPDATE SET-expressie.
--
-- Vandaar een functie: `attributes = <import> || pim_vergrendelde_attrs(...)`.
-- Rechts van || wint, dus de handmatig gezette sleutels overleven de import.
-- IMMUTABLE, want het is een pure functie van zijn twee argumenten.
CREATE OR REPLACE FUNCTION pim_vergrendelde_attrs(attrs jsonb, slot jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_object_agg(k, attrs -> k), '{}'::jsonb)
  FROM jsonb_object_keys(coalesce(attrs, '{}'::jsonb)) k
  WHERE jsonb_exists(coalesce(slot, '[]'::jsonb), 'attr:' || k)
$$;
