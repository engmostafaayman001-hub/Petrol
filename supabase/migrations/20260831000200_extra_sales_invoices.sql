-- Standalone electronic invoices. These records are intentionally independent
-- from shifts, sales, inventory, payments, and all operational calculations.
create table if not exists public.extra_sales (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  invoice_number text not null,
  station_owner_name text not null,
  tax_number text,
  commercial_registration_number text,
  registration_number text,
  email text,
  phone text,
  sale_description text not null,
  amount numeric(16,2) not null check (amount >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists extra_sales_station_invoice_number_uq
  on public.extra_sales (station_id, invoice_number);
create index if not exists extra_sales_station_created_at_idx
  on public.extra_sales (station_id, created_at desc);

alter table public.extra_sales enable row level security;

drop policy if exists extra_sales_station_read on public.extra_sales;
create policy extra_sales_station_read on public.extra_sales
  for select to authenticated
  using (public.app_owns(station_id));

drop policy if exists extra_sales_station_insert on public.extra_sales;
create policy extra_sales_station_insert on public.extra_sales
  for insert to authenticated
  with check (public.app_owns(station_id));

grant select, insert on public.extra_sales to authenticated, service_role;
