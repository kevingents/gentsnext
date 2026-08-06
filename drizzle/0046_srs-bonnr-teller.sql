-- SRS-bonnummer per filiaal, atomair in Postgres.
--
-- Aanleiding (6 aug 2026): de teller stond in een Vercel-blob en gaf na een
-- stale read hetzelfde nummer twee keer uit (Den Bosch 900001). SRS ontdubbelt
-- op bonnummer en negeerde de tweede verkoop STIL — omzet weg zonder fout.
--
-- lib/bonnr-counter.ts maakt deze tabel ook lui aan (create table if not exists),
-- zodat de fix werkt zodra de deploy live is; deze migratie is de canonieke vorm.
create table if not exists srs_bon_counters (
  filiaal text primary key,
  value integer not null,
  updated_at timestamptz not null default now()
);
