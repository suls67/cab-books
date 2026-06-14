create table if not exists hmrc_annual_submissions (
  id bigint generated always as identity primary key,
  driver_id bigint not null references drivers(id) on delete cascade,
  business_id text not null,
  tax_year text not null,
  payload jsonb not null,
  hmrc_response jsonb,
  submitted_at timestamptz not null default now()
);

create index if not exists hmrc_annual_submissions_driver_id_idx
on hmrc_annual_submissions (driver_id);

create index if not exists hmrc_annual_submissions_tax_year_idx
on hmrc_annual_submissions (tax_year);
