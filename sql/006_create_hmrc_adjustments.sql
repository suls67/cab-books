create table if not exists hmrc_adjustments (
  id bigint generated always as identity primary key,
  driver_id bigint not null references drivers(id) on delete cascade,
  business_id text not null,
  tax_year text not null,
  calculation_id text not null,
  adjustment_payload jsonb not null,
  hmrc_response jsonb,
  submitted_at timestamptz not null default now()
);

create index if not exists hmrc_adjustments_driver_id_idx
on hmrc_adjustments (driver_id);

create index if not exists hmrc_adjustments_tax_year_idx
on hmrc_adjustments (tax_year);

create index if not exists hmrc_adjustments_calculation_id_idx
on hmrc_adjustments (calculation_id);
