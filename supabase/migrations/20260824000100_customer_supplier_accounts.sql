-- Unified customer and supplier accounts. Balances are derived from immutable entries.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations (id) on delete cascade,
  name text not null,
  normalized_name text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_len check (char_length(btrim(name)) between 2 and 160),
  unique (station_id, normalized_name)
);

create index customers_station_active_idx on public.customers (station_id, is_active, name);
create trigger trg_customers_touch before update on public.customers for each row execute function public.fn_touch_updated_at();

alter table public.sales add column if not exists customer_id uuid references public.customers (id) on delete restrict;
alter table public.sales add column if not exists paid_amount numeric(16, 2) not null default 0 check (paid_amount >= 0);
alter table public.sales add column if not exists driver_name text;
alter table public.sales add column if not exists vehicle_number text;
alter table public.sales add column if not exists payment_method text;
alter table public.sales add constraint sales_paid_not_over_total check (paid_amount <= gross_amount);
create index sales_customer_idx on public.sales (customer_id, business_date desc) where customer_id is not null;

alter table public.deliveries add column if not exists paid_amount numeric(16, 2) not null default 0 check (paid_amount >= 0);
alter table public.deliveries add constraint deliveries_paid_not_over_total check (paid_amount <= round(coalesce(unit_cost, 0) * quantity, 2));

create table public.account_transactions (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations (id) on delete cascade,
  account_type text not null check (account_type in ('customer', 'supplier')),
  customer_id uuid references public.customers (id) on delete restrict,
  supplier_id uuid references public.suppliers (id) on delete restrict,
  transaction_type text not null check (transaction_type in ('sale', 'customer_payment', 'delivery', 'supplier_payment', 'adjustment')),
  debit numeric(16, 2) not null default 0 check (debit >= 0),
  credit numeric(16, 2) not null default 0 check (credit >= 0),
  amount numeric(16, 2) generated always as (debit + credit) stored,
  business_date date not null default current_date,
  payment_method text,
  reference_id uuid,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint account_transactions_one_account check ((customer_id is not null and supplier_id is null) or (customer_id is null and supplier_id is not null)),
  constraint account_transactions_type_account check ((account_type = 'customer' and customer_id is not null) or (account_type = 'supplier' and supplier_id is not null)),
  constraint account_transactions_direction check ((account_type = 'customer' and transaction_type in ('sale', 'customer_payment', 'adjustment')) or (account_type = 'supplier' and transaction_type in ('delivery', 'supplier_payment', 'adjustment'))),
  constraint account_transactions_nonzero check (debit + credit > 0)
);

create index account_transactions_customer_idx on public.account_transactions (customer_id, business_date desc, created_at desc) where customer_id is not null;
create index account_transactions_supplier_idx on public.account_transactions (supplier_id, business_date desc, created_at desc) where supplier_id is not null;

create or replace function public.fn_post_customer_sale_account()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'active' and new.customer_id is not null and (tg_op = 'INSERT' or old.status <> 'active' or old.customer_id is distinct from new.customer_id) then
    insert into public.account_transactions (station_id, account_type, customer_id, transaction_type, debit, business_date, reference_id, created_by, notes)
    values (new.station_id, 'customer', new.customer_id, 'sale', new.gross_amount - new.paid_amount, new.business_date, new.id, new.created_by, 'مبيعات آجلة');
  end if;
  return new;
end;
$$;

create or replace function public.fn_post_supplier_delivery_account()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare total numeric(16, 2);
begin
  if new.status = 'active' and new.supplier_id is not null and (tg_op = 'INSERT' or old.status <> 'active' or old.supplier_id is distinct from new.supplier_id) then
    total := round(coalesce(new.unit_cost, 0) * new.quantity, 2);
    if total - new.paid_amount > 0 then
      insert into public.account_transactions (station_id, account_type, supplier_id, transaction_type, credit, business_date, reference_id, created_by, notes)
      values (new.station_id, 'supplier', new.supplier_id, 'delivery', total - new.paid_amount, new.business_date, new.id, new.created_by, 'توريد آجل');
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_sales_customer_account after insert on public.sales for each row execute function public.fn_post_customer_sale_account();
create trigger trg_deliveries_supplier_account after insert on public.deliveries for each row execute function public.fn_post_supplier_delivery_account();

alter table public.customers enable row level security;
create policy customers_read on public.customers for select to authenticated using (public.app_owns(station_id));
create policy customers_manager_write on public.customers for all to authenticated using (public.app_is_manager() and public.app_owns(station_id)) with check (public.app_is_manager() and public.app_owns(station_id));

alter table public.account_transactions enable row level security;
create policy account_transactions_read on public.account_transactions for select to authenticated using (public.app_owns(station_id));
revoke insert, update, delete on public.account_transactions from authenticated;
grant select on public.customers, public.account_transactions to authenticated;
