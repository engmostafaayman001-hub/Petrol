-- ===========================================================================
-- 0003 · OPERATIONAL CATALOG
-- Fuel types, suppliers, tanks and the materialised tank balance.
--
-- No fuel grade is hard-coded anywhere in the schema or the application. A
-- station defines its own grades, codes, colours and prices.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Fuel types
-- ---------------------------------------------------------------------------
create table public.fuel_types (
  id                 uuid primary key default gen_random_uuid(),
  station_id         uuid        not null references public.stations (id) on delete cascade,
  code               text        not null,
  name               text        not null,
  display_unit_code  text        not null default 'L' references public.units (code),
  -- Prices are per display unit, in the station currency.
  selling_price      numeric(14, 4) check (selling_price >= 0),
  purchase_price     numeric(14, 4) check (purchase_price >= 0),
  -- Drives the colour identity of this grade everywhere in the UI. Data, not
  -- code, so a new grade is instantly recognisable without a deployment.
  color_hex          text        not null default '#5B9CFF',
  sort_order         smallint    not null default 100,
  is_active          boolean     not null default true,
  notes              text,
  created_by         uuid        references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (station_id, code),
  constraint fuel_types_code_format  check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'),
  constraint fuel_types_color_format check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  constraint fuel_types_name_len     check (char_length(btrim(name)) between 1 and 60)
);

create index fuel_types_station_idx on public.fuel_types (station_id, sort_order);

create trigger trg_fuel_types_touch
  before update on public.fuel_types
  for each row execute function public.fn_touch_updated_at();

-- Price history is kept separately so that a price change never rewrites the
-- value a past sale was recorded at.
create table public.fuel_price_history (
  id             uuid primary key default gen_random_uuid(),
  station_id     uuid        not null references public.stations (id) on delete cascade,
  fuel_type_id   uuid        not null references public.fuel_types (id) on delete cascade,
  selling_price  numeric(14, 4),
  purchase_price numeric(14, 4),
  effective_from timestamptz not null default now(),
  changed_by     uuid        references public.profiles (id) on delete set null,
  reason         text,
  created_at     timestamptz not null default now()
);

create index fuel_price_history_lookup_idx
  on public.fuel_price_history (fuel_type_id, effective_from desc);

create or replace function public.fn_capture_price_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT'
     or new.selling_price is distinct from old.selling_price
     or new.purchase_price is distinct from old.purchase_price then
    insert into public.fuel_price_history
      (station_id, fuel_type_id, selling_price, purchase_price, changed_by)
    values
      (new.station_id, new.id, new.selling_price, new.purchase_price, auth.uid());
  end if;
  return new;
end;
$$;

create trigger trg_fuel_types_price_history
  after insert or update of selling_price, purchase_price on public.fuel_types
  for each row execute function public.fn_capture_price_change();

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  station_id    uuid        not null references public.stations (id) on delete cascade,
  code          text        not null,
  name          text        not null,
  contact_name  text,
  contact_phone text,
  is_active     boolean     not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (station_id, code)
);

create trigger trg_suppliers_touch
  before update on public.suppliers
  for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Tanks
-- ---------------------------------------------------------------------------
create table public.tanks (
  id                   uuid primary key default gen_random_uuid(),
  station_id           uuid        not null references public.stations (id) on delete cascade,
  code                 text        not null,
  name                 text        not null,
  fuel_type_id         uuid        not null references public.fuel_types (id) on delete restrict,

  capacity             numeric(16, 3) not null check (capacity > 0),
  -- Usable ceiling: tankers must never fill to the physical brim.
  max_operating_level  numeric(16, 3) not null check (max_operating_level > 0),
  -- Below this the pumps risk drawing sediment / air.
  min_safe_level       numeric(16, 3) not null default 0 check (min_safe_level >= 0),
  -- Unpumpable heel at the bottom of the tank; excluded from "available" fuel.
  dead_stock           numeric(16, 3) not null default 0 check (dead_stock >= 0),

  status               public.tank_status not null default 'operational',
  is_active            boolean     not null default true,
  installed_on         date,
  notes                text,
  created_by           uuid        references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (station_id, code),
  constraint tanks_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'),
  constraint tanks_levels_ordered check (
    min_safe_level <= max_operating_level
    and max_operating_level <= capacity
    and dead_stock <= min_safe_level
  )
);

create index tanks_station_idx on public.tanks (station_id) where is_active;
create index tanks_fuel_type_idx on public.tanks (fuel_type_id);

create trigger trg_tanks_touch
  before update on public.tanks
  for each row execute function public.fn_touch_updated_at();

-- A tank and its fuel type must belong to the same station, and a tank that
-- already holds product cannot silently be re-graded — that would corrupt every
-- fuel-level report retroactively.
create or replace function public.fn_validate_tank()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fuel_station uuid;
  v_balance      numeric;
begin
  select station_id into v_fuel_station from public.fuel_types where id = new.fuel_type_id;

  if v_fuel_station is null or v_fuel_station <> new.station_id then
    raise exception 'The selected fuel type does not belong to this station.'
      using errcode = 'foreign_key_violation';
  end if;

  if tg_op = 'UPDATE' and new.fuel_type_id <> old.fuel_type_id then
    select coalesce(quantity, 0) into v_balance
      from public.tank_balances where tank_id = new.id;

    if coalesce(v_balance, 0) <> 0 then
      raise exception
        'Tank % still holds % units. Empty the tank before changing its fuel grade.',
        old.code, public.fn_vol(v_balance)
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tank balance (materialised current stock)
--
-- This is a cache of sum(inventory_transactions.quantity_delta), maintained by
-- the ledger posting function under a row lock. It is never written directly by
-- the application. `public.tank_balance_check` re-derives it from the ledger for
-- reconciliation of the reconciler.
-- ---------------------------------------------------------------------------
create table public.tank_balances (
  tank_id      uuid primary key references public.tanks (id) on delete cascade,
  station_id   uuid        not null references public.stations (id) on delete cascade,
  quantity     numeric(16, 3) not null default 0,
  last_txn_id  bigint,
  last_movement_at timestamptz,
  updated_at   timestamptz not null default now()
);

create index tank_balances_station_idx on public.tank_balances (station_id);

create or replace function public.fn_create_tank_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.tank_balances (tank_id, station_id, quantity)
  values (new.id, new.station_id, 0)
  on conflict (tank_id) do nothing;
  return new;
end;
$$;

create trigger trg_tanks_balance_row
  after insert on public.tanks
  for each row execute function public.fn_create_tank_balance();

create trigger trg_tanks_validate
  before insert or update on public.tanks
  for each row execute function public.fn_validate_tank();
