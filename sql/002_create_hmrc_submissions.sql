create table if not exists hmrc_submissions (
  id bigint generated always as identity primary key,
  driver_id bigint not null references drivers(id) on delete cascade,
  business_id text,
  period_id text not null,
  period_start date not null,
  period_end date not null,
  turnover numeric not null default 0,
  expenses numeric not null default 0,
  submitted_at timestamptz not null default now(),
  hmrc_response jsonb
);

create index if not exists hmrc_submissions_driver_id_idx
on hmrc_submissions (driver_id);

create index if not exists hmrc_submissions_period_id_idx
on hmrc_submissions (period_id);
