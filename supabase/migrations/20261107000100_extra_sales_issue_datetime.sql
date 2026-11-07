-- Keep the invoice issue timestamp distinct from the system creation timestamp.
alter table public.extra_sales
  add column if not exists date_time_issued timestamptz;

-- Preserve existing invoices by deriving their issue time from the historical creation time.
update public.extra_sales
set date_time_issued = created_at
where date_time_issued is null;
