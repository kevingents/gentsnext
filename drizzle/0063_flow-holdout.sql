-- Holdout per flow: een vast klein deel van de instappers krijgt bewust niets,
-- zodat je kunt zien wat de flow werkelijk oplevert in plaats van te tellen wie
-- er ná een mail toevallig bestelde.
--
-- 0 = uit (standaard). Een bestaande flow verandert dus niet vanzelf van
-- gedrag; je zet de controlegroep zelf aan.
alter table email_flows
  add column if not exists holdout_procent integer not null default 0;

-- De controlegroep is een STATUS, geen apart tabel: dan loopt hij automatisch
-- mee in elke telling per flow, en kan hij nooit per ongeluk een stap krijgen
-- (de loper pakt alleen status = 'loopt').
comment on column email_flows.holdout_procent is
  'Percentage instappers dat status ''holdout'' krijgt en nooit gemaild wordt. 0 = uit.';

-- De meting joint per klant op verzendmoment; deze index maakt dat een
-- indexscan in plaats van een seq scan over alle orders.
create index if not exists orders_klant_betaald_idx
  on orders (customer_id, coalesce(paid_at, created_at));
