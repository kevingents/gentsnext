-- Tegoedbon: vastleggen WAT de code verzilverde.
--
-- Aan de kassa is een verzilvering niet één keer maar mogelijk meerdere keren
-- onderweg: een POST kan opnieuw komen na een netwerkfout of via de offline-sync.
-- redeemVoucher() geeft dan false ("al gebruikt") — terwijl het onze eigen
-- eerdere, geslaagde verzilvering was. De kassier ziet een geldige tegoedbon
-- geweigerd worden, of trekt 'm bij een tweede poging alsnog dubbel af.
--
-- Met de referentie erbij is dat onderscheid wél te maken: zelfde bon = ja,
-- dit is al geregeld; andere bon = deze code is echt op. Dezelfde les als de
-- over-retour-guard: idempotentie hoort aan de BRON vast te zitten, niet aan
-- een losse status.
alter table vouchers
  add column if not exists redeemed_ref text not null default '';
