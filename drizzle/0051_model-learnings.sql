-- Beoordelingen van modelfoto's (goed-/afkeuren met categorie + notitie).
--
-- Stond in een Vercel-blob: hele bestand lezen, één regel erbij, alles terug-
-- schrijven. Twee mensen die tegelijk foto's beoordelen lezen dan dezelfde
-- versie en de laatste schrijver gooit de ander weg. Dezelfde vorm als de
-- SRS-bonnummerteller die op 6 aug 2026 stil een verkoop liet verdwijnen
-- (zie 0046_srs-bonnr-teller.sql). Eén INSERT kent die race niet.
--
-- lib/model-learnings.ts maakt deze tabel ook lui aan (create table if not
-- exists) zodat het werkt zodra de deploy live is; deze migratie is de
-- canonieke vorm. legacy_key is alleen gevuld voor de eenmalige import uit de
-- oude blob, zodat dubbel importeren niets dupliceert.
create table if not exists model_learnings (
  id bigserial primary key,
  handle text,
  url text,
  topic text not null default 'model',
  category text not null,
  reason text not null default '',
  directive text,
  kind text not null default 'negative',
  at timestamptz not null default now(),
  legacy_key text unique
);

create index if not exists model_learnings_handle_idx on model_learnings (handle);
create index if not exists model_learnings_at_idx on model_learnings (at desc);
