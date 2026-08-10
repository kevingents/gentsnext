-- Kassa toont de packshot i.p.v. de eerste foto (10 aug 2026).
--
-- De kassa liet het eerste beeld van een product zien (order by position). Is dat
-- een modelfoto, dan zag de kassier een model in plaats van het artikel. Een
-- beeld-classificatie in storegents beoordeelt nu elke foto afzonderlijk; deze
-- kolom bewaart die uitslag hier, zodat de kassa-query 'm kan gebruiken zonder
-- eerst een blob in storegents te moeten lezen.
--
-- BEWUST EEN APARTE KOLOM, geen herordening van `position`: gents.nl toont de
-- foto's in position-volgorde. De packshot vooraan zetten zou dus ook het eerste
-- beeld op de website veranderen, en dat is een redactionele keuze die niet aan
-- deze classificatie is. `position` blijft de volgorde van de site; is_packshot
-- is alleen voor de kassa.
--
-- Default false = het huidige gedrag. Zolang een product niet beoordeeld is,
-- staan al z'n foto's op false en valt de query terug op position — precies zoals
-- nu. Er is dus geen moment waarop de kassa zonder beeld zit.
--
-- Gevuld via POST /api/core/catalog/packshots (storegents, na elke classificatie-
-- batch). Partiële index omdat er per product hooguit een handvol packshots is en
-- de query alleen naar de true-rijen zoekt.

ALTER TABLE "product_images"
  ADD COLUMN IF NOT EXISTS "is_packshot" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "images_product_packshot_idx"
  ON "product_images" ("product_id")
  WHERE "is_packshot";
