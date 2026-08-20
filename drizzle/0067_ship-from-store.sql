-- Kassa-bestelling met vaste leverwinkel ("komt uit winkel X", kassa #544):
-- de fulfilment-planning pint het plan op deze winkel i.p.v. zelf te alloceren.
-- Alleen gevuld bij bezorgen; '' = allocator kiest vrij (webshop-orders).
-- IF NOT EXISTS: de kolom wordt vóór de merge al handmatig op prod gezet
-- (additief, oude code negeert 'm) zodat er geen deploy-gat is.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_from_store" text DEFAULT '' NOT NULL;
