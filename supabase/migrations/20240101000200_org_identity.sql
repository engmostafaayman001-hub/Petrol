-- ===========================================================================
-- 0002 · ORGANISATION & IDENTITY
-- Stations, units of measure, user profiles, shifts and per-station settings.
--
-- Multi-station readiness: every operational entity in later migrations carries
-- a station_id. v1 ships with one station, but nothing in the schema, the RLS
-- policies or the calculation engine assumes that.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Units of measure
--
-- IMPORTANT INVARIANT: the inventory ledger stores every quantity in the
-- station's base unit. Display units exist for presentation and pricing only,
-- and conversion happens in the presentation layer. Mixing units inside the
-- ledger is the single most common source of unrecoverable inventory drift, so
-- the schema makes it structurally impossible.
-- ---------------------------------------------------------------------------
create table public.units (
  code              text primary key,
  name              text        not null,
  symbol            text        not null,
  liters_per_unit   numeric(16, 6) not null check (liters_per_unit > 0),
  created_at        timestamptz not null default now()
);

insert into public.units (code, name, symbol, liters_per_unit) values
  ('L',   'Litre',        'L',   1),
  ('M3',  'Cubic metre',  'm³',  1000),
  ('GAL', 'US gallon',    'gal', 3.785412),
  ('IGAL','Imperial gallon', 'gal', 4.546090);

-- ---------------------------------------------------------------------------
-- Stations
-- ---------------------------------------------------------------------------
create table public.stations (
  id              uuid primary key default gen_random_uuid(),
  code            text        not null unique,
  name            text        not null,
  legal_name      text,
  address         text,
  city            text,
  country_code    text,
  timezone        text        not null default 'UTC',
  currency_code   text        not null default 'USD',
  base_unit_code  text        not null default 'L' references public.units (code),
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint stations_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$')
);

create trigger trg_stations_touch
  before update on public.stations
  for each row execute function public.fn_touch_updated_at();

comment on column public.stations.base_unit_code is
  'Canonical unit for every stored quantity at this station. Changing it after transactions exist is not supported.';

-- ---------------------------------------------------------------------------
-- Profiles — 1:1 with auth.users
--
-- The role lives here rather than in JWT app_metadata so a manager can change
-- it without minting a new token, and so RLS reads a single source of truth.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  station_id   uuid        not null references public.stations (id) on delete restrict,
  full_name    text        not null,
  email        text        not null,
  phone        text,
  role         public.user_role not null default 'supervisor',
  is_active    boolean     not null default true,
  last_seen_at timestamptz,
  created_by   uuid        references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint profiles_full_name_len check (char_length(btrim(full_name)) between 2 and 120)
);

create index profiles_station_idx on public.profiles (station_id) where is_active;
create unique index profiles_email_key on public.profiles (lower(email));

create trigger trg_profiles_touch
  before update on public.profiles
  for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Authorization helpers
--
-- SECURITY DEFINER so that policies on `profiles` itself do not recurse.
-- STABLE so the planner evaluates them once per statement.
-- ---------------------------------------------------------------------------
create or replace function public.app_station_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select p.station_id from public.profiles p where p.id = auth.uid() and p.is_active $$;

create or replace function public.app_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select p.role from public.profiles p where p.id = auth.uid() and p.is_active $$;

create or replace function public.app_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce((select p.role = 'manager' from public.profiles p
                        where p.id = auth.uid() and p.is_active), false) $$;

-- True for any active member of a station. Disabling a user therefore revokes
-- access instantly at the database level, without waiting for token expiry.
create or replace function public.app_is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active) $$;

-- The role claim carried by the request's JWT. Unlike current_user this stays
-- readable inside SECURITY DEFINER functions, so an RPC can tell a browser
-- session apart from a trusted server-side service_role call.
create or replace function public.app_jwt_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'anon'
  );
$$;

-- Convenience guard used by policies: row belongs to the caller's station and
-- the caller is an active member.
create or replace function public.app_owns(p_station_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select p_station_id is not distinct from public.app_station_id()
       and public.app_is_active_member() $$;

comment on function public.app_owns is
  'Station-scoping predicate shared by every RLS policy.';

-- ---------------------------------------------------------------------------
-- Shifts
--
-- A station that reconciles once per day simply defines a single shift that
-- spans 24 hours. The engine never special-cases "daily" vs "per shift"; the
-- period is always (business_date, shift).
-- ---------------------------------------------------------------------------
create table public.shifts (
  id          uuid primary key default gen_random_uuid(),
  station_id  uuid        not null references public.stations (id) on delete cascade,
  code        text        not null,
  name        text        not null,
  starts_at   time        not null,
  ends_at     time        not null,
  -- Ordinal position of the shift within a business day. Together with
  -- business_date this forms the total ordering used to compute an opening
  -- balance for any period. Must be unique and stable.
  seq         smallint    not null check (seq between 1 and 99),
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (station_id, code),
  unique (station_id, seq)
);

create trigger trg_shifts_touch
  before update on public.shifts
  for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Per-station settings
--
-- Business thresholds live in data, not in code. The calculation engine reads
-- them; changing a threshold never requires a deployment.
-- ---------------------------------------------------------------------------
create table public.system_settings (
  station_id                  uuid primary key references public.stations (id) on delete cascade,

  -- Variance classification. A line is BALANCED when it is within the absolute
  -- tolerance; otherwise it is graded by |variance %| against these bands.
  variance_abs_tolerance      numeric(16, 3) not null default 5    check (variance_abs_tolerance >= 0),
  variance_minor_pct          numeric(6, 3)  not null default 0.30 check (variance_minor_pct    >= 0),
  variance_warning_pct        numeric(6, 3)  not null default 0.75 check (variance_warning_pct  >= 0),
  variance_critical_pct       numeric(6, 3)  not null default 1.50 check (variance_critical_pct >= 0),

  -- Operational alerting
  tank_low_level_pct          numeric(6, 3)  not null default 15   check (tank_low_level_pct  between 0 and 100),
  tank_high_level_pct         numeric(6, 3)  not null default 92   check (tank_high_level_pct between 0 and 100),
  unusual_sales_factor        numeric(6, 3)  not null default 2.5  check (unusual_sales_factor > 0),

  -- Integrity switches
  allow_negative_balance      boolean not null default false,
  enforce_tank_capacity       boolean not null default true,
  require_adjustment_approval boolean not null default true,
  -- When true a submitted reconciliation immediately posts its variance to the
  -- ledger so stock reflects the physical measurement. When false the variance
  -- is only posted once a manager approves the session.
  post_variance_on_submit     boolean not null default true,

  -- Presentation
  volume_decimals             smallint not null default 2 check (volume_decimals between 0 and 3),

  updated_by                  uuid references public.profiles (id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint variance_bands_ordered check (
    variance_minor_pct <= variance_warning_pct
    and variance_warning_pct <= variance_critical_pct
  )
);

create trigger trg_system_settings_touch
  before update on public.system_settings
  for each row execute function public.fn_touch_updated_at();

-- Guarantees every station has settings; the engine never has to cope with a
-- missing row.
create or replace function public.fn_station_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.system_settings (station_id) values (new.id)
  on conflict (station_id) do nothing;
  return new;
end;
$$;

create trigger trg_stations_defaults
  after insert on public.stations
  for each row execute function public.fn_station_defaults();
