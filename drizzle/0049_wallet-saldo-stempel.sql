-- Apple-Wallet-pas: onthouden welk saldo er op de pas staat.
--
-- Aanleiding (11 aug 2026): de punten-backfill boekte 2,87 mln punten
-- rechtstreeks in SQL en riep pushPassUpdate niet aan. Een gemiste push geeft
-- geen fout — de klant ziet gewoon een oud getal op z'n pas, en niemand merkt
-- het. Zonder opgeslagen referentie is "loopt deze pas achter?" niet te stellen.
--
-- Met deze kolom wordt achterlopen meetbaar: de cron
-- /api/cron/wallet-vesting-push vergelijkt 'm met het GEVESTE saldo (dat is wat
-- de pas toont) en pusht wat afwijkt — ongeacht welk pad het saldo veranderde.
-- NULL = nog nooit gepusht → wordt bij de eerste ronde meegenomen.
alter table wallet_apple_registrations
  add column if not exists last_pushed_points integer;
