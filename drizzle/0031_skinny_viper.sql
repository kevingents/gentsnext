-- Ontdubbel bestaande afwijkingen op (shipment_id, stock_key, code) vóór de unieke index
-- (twee eerdere gelijktijdige ontvangsten konden dubbele rijen loggen). Houd de oudste rij.
DELETE FROM "receiving_discrepancies" a
USING "receiving_discrepancies" b
WHERE a.ctid > b.ctid
  AND a."shipment_id" = b."shipment_id"
  AND a."stock_key" = b."stock_key"
  AND a."code" = b."code";
--> statement-breakpoint
CREATE UNIQUE INDEX "recdisc_uq" ON "receiving_discrepancies" USING btree ("shipment_id","stock_key","code");