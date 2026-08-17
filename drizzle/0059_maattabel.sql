-- De maattabel als data, plus een log van uitgebrachte maatadviezen (14 aug 2026).
--
-- Met de hand geschreven, niet via `db:generate`: de drizzle-snapshot staat nog
-- op 0045 terwijl 0046-0058 met de hand zijn gezet, dus een generate wil hier
-- twaalf bestaande tabellen opnieuw aanmaken. Zie drizzle/README.md.
-- Uitvoeren: npm run db:migratie -- drizzle/0059_maattabel.sql
--
-- WAAROM. De GENTS-maatvoering stond hardgecodeerd in lib/size-chart.ts (een
-- export uit Faslet van juni 2026). Die tabel bepaalt wat het maatadvies
-- adviseert, wat er in de maattabellen op de site staat en waar de PDP-knop
-- "Onze maattabel" naar wijst. Een correctie op de maatvoering was daarmee een
-- codewijziging plus een deploy — precies het soort instelling dat volgens de
-- projectregel in de tool hoort en niet in de repo.
--
-- Nu: het Excel-blad gaat in de portal naar binnen. Elke upload is een VERSIE en
-- precies één versie staat op actief, dus terugdraaien is een knop. Dat is geen
-- luxe: als iemand een verkeerd blad inleest, adviseert de site meteen verkeerde
-- maten aan iedereen, en dan wil je niet wachten op een revert-deploy.
--
-- lib/size-chart.ts blijft staan als fallback. Zonder geüploade versie (of met
-- een DB die eruit ligt) draait de site op de ingebakken tabel. Een maatadvies
-- dat "geen advies" zegt is erger dan een maatadvies van vorige maand.

CREATE TABLE IF NOT EXISTS "maattabel_versies" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Oplopend nummer dat de portal toont. Niet de uuid: "versie 3" is een
  -- gesprek, een uuid niet.
  "versie"        integer NOT NULL,
  "bestandsnaam"  text NOT NULL DEFAULT '',
  -- Portal-gebruiker. INTERN: medewerkersnaam, nooit klantzichtbaar (zelfde les
  -- als loyalty_events.reason, dat wél in het klantprofiel opdook).
  "actor"         text NOT NULL DEFAULT '',
  "aantal_rijen"  integer NOT NULL DEFAULT 0,
  "actief"        boolean NOT NULL DEFAULT false,
  "notitie"       text NOT NULL DEFAULT '',
  "created_at"    timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "maattabel_versies_nr_idx"
  ON "maattabel_versies" ("versie");

CREATE INDEX IF NOT EXISTS "maattabel_versies_tijd_idx"
  ON "maattabel_versies" ("created_at" DESC);

-- BEWUST GEEN unieke index op "actief".
--
-- Voor de hand liggend zou zijn: CREATE UNIQUE INDEX ... ("actief") WHERE "actief".
-- Dat maakt activeren juist gevaarlijker. Met zo'n index kan het niet in één
-- statement — je moet eerst alles op false zetten en dan de nieuwe op true, en
-- tussen die twee statements is er GEEN actieve versie. Deze DB praat via
-- neon-http en dat kent geen transacties, dus dat gat is echt: precies dan valt
-- de site terug op de ingebakken tabel.
--
-- Zonder index kan het in één atomair statement:
--   UPDATE maattabel_versies SET actief = (id = $1) WHERE actief OR id = $1;
-- Nooit nul actieve versies, nooit twee. Het lezen is bovendien tolerant
-- (ORDER BY versie DESC LIMIT 1), dus zelfs een handmatige UPDATE die twee
-- versies op actief zet levert een voorspelbare uitkomst en geen 500.

CREATE TABLE IF NOT EXISTS "maattabel_rijen" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "versie_id"      uuid NOT NULL,
  -- 'TOP' | 'BOTTOM' | 'FULL_BODY'
  "product_type"   text NOT NULL DEFAULT 'TOP',
  "categorie"      text NOT NULL,
  "maat"           text NOT NULL,
  -- Alleen bij Overhemden (Boordmaat): de halsomvang, "39-40". In de code waren
  -- dat twee losse arrays (SIZE_CHART + BOORD_CHART) met dezelfde borst/taille
  -- eronder; dat is één tabel met een extra kolom, niet twee tabellen.
  "boord_cm"       text NOT NULL DEFAULT '',
  -- Lichaamsmaten in cm. min = max betekent een puntwaarde (zo staat colbert en
  -- pak in de bron: maat 50 = 107 cm, geen range). NULL = de bron geeft deze
  -- maat niet voor deze categorie. Bewust nullable en niet 0: "0 cm borst" is
  -- een meetwaarde en "onbekend" is dat niet.
  "borst_min"      integer,
  "borst_max"      integer,
  "taille_min"     integer,
  "taille_max"     integer,
  "binnenbeen_min" integer,
  "binnenbeen_max" integer,
  -- Rijvolgorde uit het blad. Nodig omdat maten niet alfabetisch of numeriek
  -- sorteren: S/M/L/XL door elkaar met 44/46/48 en 90/94/98.
  "sortering"      integer NOT NULL DEFAULT 0
);

-- De twee leesvormen: de hele actieve tabel op volgorde (het scherm en de
-- site-tabellen), en één categorie eruit (het maatadvies, de PDP-knop).
CREATE INDEX IF NOT EXISTS "maattabel_rijen_versie_idx"
  ON "maattabel_rijen" ("versie_id", "sortering");

CREATE INDEX IF NOT EXISTS "maattabel_rijen_cat_idx"
  ON "maattabel_rijen" ("versie_id", "categorie");

-- Rijen horen bij hun versie; een versie weggooien gooit de rijen mee.
ALTER TABLE "maattabel_rijen"
  DROP CONSTRAINT IF EXISTS "maattabel_rijen_versie_fk";
ALTER TABLE "maattabel_rijen"
  ADD CONSTRAINT "maattabel_rijen_versie_fk"
  FOREIGN KEY ("versie_id") REFERENCES "maattabel_versies"("id") ON DELETE CASCADE;

-- Elk uitgebracht maatadvies, om te kunnen meten of het advies deugt.
--
-- De vraag die hierachter zit: adviseren we maat 44 aan iemand die uiteindelijk
-- 54 koopt en houdt? Dat was onbeantwoordbaar — we kenden alleen de uitkomst van
-- de formule, nooit of hij klopte. Het advies vergelijken met wat de klant kocht
-- én hield (niet retourneerde) is de enige eerlijke meting.
--
-- AVG: lengte en gewicht zijn persoonsgegevens zódra ze aan iemand hangen.
-- `klant_id` staat er daarom alleen bij een INGELOGDE bezoeker — die gaf bij
-- Mijn maten toestemming voor precies dit doel. Een anonieme bezoeker levert een
-- rij zonder enige identificatie: geen sessie-id, geen IP, geen fingerprint.
-- Bij accountverwijdering zetten we `klant_id` op null (zie lib/account.ts):
-- de meting blijft bruikbaar, de persoon is eruit.
CREATE TABLE IF NOT EXISTS "maatadvies_log" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "klant_id"          uuid,
  "lengte_cm"         integer NOT NULL DEFAULT 0,
  "gewicht_kg"        integer NOT NULL DEFAULT 0,
  -- 'slim' | 'regular' | 'comfort'
  "pasvorm"           text NOT NULL DEFAULT 'regular',
  -- De borstomvang waar het advies op grondde: gemeten of geschat.
  "borst_cm"          integer NOT NULL DEFAULT 0,
  -- True als de klant zijn eigen lichaamsmaten invulde. Dat scheidt "de formule
  -- zat ernaast" van "de schatting uit lengte/gewicht zat ernaast" — twee heel
  -- verschillende fouten met twee verschillende oplossingen.
  "gemeten"           boolean NOT NULL DEFAULT false,
  "advies_colbert"    text NOT NULL DEFAULT '',
  "advies_boord"      text NOT NULL DEFAULT '',
  "advies_lengtemaat" text NOT NULL DEFAULT '',
  -- 'hoog' | 'gemiddeld' | 'laag' — de eigen zekerheid van het advies.
  "zekerheid"         text NOT NULL DEFAULT 'gemiddeld',
  -- 'maatadvies' | 'pdp' | 'account'
  "bron"              text NOT NULL DEFAULT 'maatadvies',
  -- Op welke maattabel-versie dit advies grondde. 0 = de fallback in code.
  -- Zonder dit kun je na een upload niet zien of het béter werd.
  "tabel_versie"      integer NOT NULL DEFAULT 0,
  "created_at"        timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "maatadvies_log_klant_idx"
  ON "maatadvies_log" ("klant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "maatadvies_log_tijd_idx"
  ON "maatadvies_log" ("created_at" DESC);
