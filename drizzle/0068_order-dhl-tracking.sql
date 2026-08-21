-- Track & trace op de order zelf (kassa-klantkaart: "waar is deze bestelling?").
-- order-docs maakt het DHL-label en gaf de trackingcode alleen terug aan de
-- winkel-UI — nergens opgeslagen, dus de klantkaart kon 'm niet tonen. Bij een
-- nieuw label (herprint) overschrijft de laatste code de vorige: dat is het
-- label dat op de doos zit.
-- IF NOT EXISTS: de kolom wordt vóór de merge al handmatig op prod gezet
-- (additief, oude code negeert 'm) zodat er geen deploy-gat is.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "dhl_tracking" text DEFAULT '' NOT NULL;
