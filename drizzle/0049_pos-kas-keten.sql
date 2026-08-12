-- Kassa-keten naar Neon: kasmutaties, kas-openingen en geparkeerde mandjes.
--
-- Aanleiding (aug 2026): deze drie stores leefden nog als storegents-blobs
-- (admin/pos-kas-mutaties.json, admin/kassa-openings.json, admin/pos-sales-drafts.json).
-- Vercel Blob heeft geen compare-and-swap en een bekende read-after-write-lag;
-- voor kasadministratie (geldspoor!) is last-writer-wins niet acceptabel — zie
-- de pos_sales-les van 4 aug (blob miste 36 van 41 bonnen). Zelfde opzet als
-- pos_sales/pos_closings: queryable kolommen + het volledige record als jsonb
-- `data`, zodat de storegents-rekenlogica ongewijzigd blijft.
--
-- Geen caps/ringbuffers meer (de blobs knipten op 2000/3000/500 records) —
-- dit is kasadministratie, die bewaar je gewoon.
create table if not exists pos_kas_mutaties (
  id text primary key,
  store text not null,
  date text not null,
  type text not null,
  amount_cents integer not null default 0,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists pos_kas_mutaties_store_date_idx on pos_kas_mutaties (store, date);

create table if not exists pos_openings (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  date text not null,
  amount_cents integer not null default 0,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pos_openings_store_date_unique on pos_openings (store, date);

create table if not exists pos_drafts (
  id text primary key,
  store text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pos_drafts_store_updated_idx on pos_drafts (store, updated_at);
