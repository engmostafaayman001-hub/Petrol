-- Customer accounting transactions are intentionally separate from fuel sales.
-- They never create inventory movements, meter sales, sessions, or tank changes.
create table public.customer_internal_transactions (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  transaction_type text not null default 'purchase',
  description text not null,
  quantity numeric(16,3) not null default 0 check (quantity >= 0),
  unit text not null default 'وحدة',
  unit_price numeric(14,4) not null default 0 check (unit_price >= 0),
  subtotal numeric(16,2) generated always as (round(quantity * unit_price, 2)) stored,
  discount numeric(16,2) not null default 0 check (discount >= 0),
  total numeric(16,2) generated always as (greatest(round(quantity * unit_price, 2) - discount, 0)) stored,
  paid_amount numeric(16,2) not null default 0 check (paid_amount >= 0),
  remaining numeric(16,2) generated always as (greatest(greatest(round(quantity * unit_price, 2) - discount, 0) - paid_amount, 0)) stored,
  business_date date not null default current_date,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_internal_discount_not_over_subtotal check (discount <= round(quantity * unit_price, 2)),
  constraint customer_internal_paid_not_over_total check (paid_amount <= greatest(round(quantity * unit_price, 2) - discount, 0))
);
create index customer_internal_transactions_customer_idx on public.customer_internal_transactions(customer_id, business_date desc, created_at desc);
create index customer_internal_transactions_station_idx on public.customer_internal_transactions(station_id, business_date desc);
create trigger trg_customer_internal_transactions_touch before update on public.customer_internal_transactions for each row execute function public.fn_touch_updated_at();
alter table public.customer_internal_transactions enable row level security;
create policy customer_internal_transactions_read on public.customer_internal_transactions for select to authenticated using (public.app_owns(station_id));
create policy customer_internal_transactions_insert on public.customer_internal_transactions for insert to authenticated with check (public.app_owns(station_id) and created_by = auth.uid());
create policy customer_internal_transactions_manager_update on public.customer_internal_transactions for update to authenticated using (public.app_owns(station_id) and public.app_is_manager()) with check (public.app_owns(station_id) and public.app_is_manager());
create policy customer_internal_transactions_manager_delete on public.customer_internal_transactions for delete to authenticated using (public.app_owns(station_id) and public.app_is_manager());
grant select, insert, update, delete on public.customer_internal_transactions to authenticated;
