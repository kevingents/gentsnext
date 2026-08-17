-- Velden uit de Spotler-export (Kevin, 13 aug 2026).
--
-- De REST-API bleek onbruikbaar voor bulk: `GET contact` geeft er 250 en
-- bladert niet, en het filter wordt genegeerd. De export uit Spotler zelf lost
-- dat in één keer op: 1,69 miljoen profielen, waarvan 252.997 met e-mail, en
-- daarvan is 98,8% van ONS klantbestand terug te vinden (47.946 van 48.507).
--
-- Wat de export brengt dat wij niet hadden: 39.073 SRS-klantnummers (wij: 633),
-- 42.286 postcodes, 18.431 telefoonnummers, 15.587 keer geslacht, 2.826
-- verjaardagen en 19.533 nieuwsbrief-opt-ins.

ALTER TABLE "mail_engagement" ADD COLUMN IF NOT EXISTS "postcode" text DEFAULT '' NOT NULL;
ALTER TABLE "mail_engagement" ADD COLUMN IF NOT EXISTS "plaats" text DEFAULT '' NOT NULL;
-- 'Orientation Phase' | 'Customers' | 'Decision Phase' | 'Comparison Phase' —
-- Spotlers eigen fase-indeling. Bewaren als bron, niet als waarheid: ons eigen
-- segment is op onze data gebaseerd en heeft voorrang.
ALTER TABLE "mail_engagement" ADD COLUMN IF NOT EXISTS "spotler_fase" text DEFAULT '' NOT NULL;
ALTER TABLE "mail_engagement" ADD COLUMN IF NOT EXISTS "spotler_doelgroepen" text DEFAULT '' NOT NULL;
