-- Wat er met onze eigen mails gebeurt: bezorgd, geopend, geklikt, gebounced,
-- als spam gemeld.
--
-- Dit hadden we niet. De open- en klikcijfers in het 360-profiel komen uit de
-- Spotler-export: per e-mailadres opgeteld en historisch, dus ze zeggen niets
-- over een mail die onze flow gisteren stuurde.
create table if not exists mail_gebeurtenissen (
  id uuid primary key default gen_random_uuid(),

  -- De sleutel van de webhook zelf. Svix probeert een melding opnieuw als hij
  -- geen 2xx kreeg, dus zonder deze index tel je dezelfde opening drie keer.
  webhook_id text not null,

  bericht_id text not null default '',
  soort text not null,

  -- Terugkoppeling naar de flow, uit de labels die we meestuurden. Leeg voor
  -- gewone transactionele mails: die gaan ook door deze webhook heen en zijn
  -- op zichzelf nuttig om te zien.
  lid_id uuid references email_flow_leden (id) on delete cascade,
  flow_id uuid references email_flows (id) on delete cascade,
  stap integer,
  customer_id uuid references customers (id) on delete set null,

  email text not null default '',
  -- Bij een klik: waar hij heen ging. Zo zie je wélke link werkt, niet alleen
  -- dát er geklikt is.
  url text not null default '',
  gebeurd_op timestamptz not null default now()
);

create unique index if not exists mail_gebeurtenissen_webhook_uniek on mail_gebeurtenissen (webhook_id);
create index if not exists mail_gebeurtenissen_flow_idx on mail_gebeurtenissen (flow_id, stap, soort);
create index if not exists mail_gebeurtenissen_klant_idx on mail_gebeurtenissen (customer_id, gebeurd_op);
create index if not exists mail_gebeurtenissen_lid_idx on mail_gebeurtenissen (lid_id, soort);
