create table if not exists hmrc_calculations (
  id bigint generated always as identity primary key,
  driver_id bigint not null references drivers(id) on delete cascade,
  tax_year text not null,
  calculation_type text not null,
  calculation_id text not null unique,
  status text not null default 'pending',
  tax_due numeric,
  nic numeric,
  income_sources jsonb,
  allowances jsonb,
  submission_date timestamptz,
  errors jsonb not null default '[]'::jsonb,
  disclaimer text,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hmrc_calculations_driver_id_idx
on hmrc_calculations (driver_id);

create index if not exists hmrc_calculations_driver_tax_year_idx
on hmrc_calculations (driver_id, tax_year);

create index if not exists hmrc_calculations_status_idx
on hmrc_calculations (status);
