-- Beoordelingen van sfeerbeelden (afkeuren met categorie + notitie, of "top").
--
-- Zelfde verhaal als 0051_model-learnings.sql: stond in een Vercel-blob die bij
-- elke beoordeling helemaal gelezen en teruggeschreven werd, dus twee mensen die
-- tegelijk beelden beoordelen overschrijven elkaar. Eén INSERT kent die race niet.
--
-- lib/visual-learnings.ts maakt deze tabel ook lui aan (create table if not
-- exists) zodat het werkt zodra de deploy live is; deze migratie is de canonieke
-- vorm. legacy_key is alleen gevuld voor de eenmalige import uit de oude blob,
-- zodat dubbel importeren niets dupliceert.
create table if not exists visual_learnings (
  id bigserial primary key,
  handle text,
  slot integer,
  url text,
  topic text not null default 'beeld',
  category text not null,
  reason text not null default '',
  directive text,
  kind text not null default 'negative',
  at timestamptz not null default now(),
  legacy_key text unique
);

create index if not exists visual_learnings_handle_idx on visual_learnings (handle);
create index if not exists visual_learnings_at_idx on visual_learnings (at desc);
