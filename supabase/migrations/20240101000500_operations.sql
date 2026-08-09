-- ===========================================================================
-- 0005 · OPERATIONAL RECORDS
-- Deliveries, sales, measurements and authorised adjustments.
--
-- BUSINESS RULE (enforced here, not in the application):
-- An operational record is captured once and never edited. A mistake is
-- corrected by voiding the record — which appends a reversing ledger entry and
-- preserves the original exactly as it was captured — or by raising an
-- adjustment that a manager must approve.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Shared guard: operational records are write-once
--
-- The only permitted UPDATE is the active -> voided transition, and it may only
-- write the void metadata. Everything substantive is snapped back to its
-- original value, so even a crafted PostgREST PATCH cannot rewrite a quantity.
-- ---------------------------------------------------------------------------
create or replace function public.fn_guard_operational_record()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'voided' then
    raise exception 'This record has already been voided and can no longer change.'
      using errcode = 'restrict_violation';
  end if;

  if new.status is distinct from 'voided'::public.record_status then
    raise exception 'Operational records cannot be edited. Void the record and capture a corrected one.'
      using errcode = 'restrict_violation';
  end if;

  if coalesce(btrim(new.void_reason), '') = '' then
    raise exception 'A reason is required when voiding a record.'
      using errcode = 'check_violation';
  end if;

  new.station_id    := old.station_id;
  new.tank_id       := old.tank_id;
  new.fuel_type_id  := old.fuel_type_id;
  new.quantity      := old.quantity;
  new.business_date := old.business_date;
  new.shift_id      := old.shift_id;
  new.created_by    := old.created_by;
  new.created_at    := old.created_at;
  new.ledger_txn_id := old.ledger_txn_id;

  new.voided_by := coalesce(new.voided_by, auth.uid());
  new.voided_at := coalesce(new.voided_at, now());

  return new;
end;
$$;

-- Shared pre-flight checks for anything that moves product.
-- Returns the tank so callers do not re-read it.
create or replace function public.fn_assert_movement_context(
  p_station_id   uuid,
  p_tank_id      uuid,
  p_fuel_type_id uuid,
  p_business_date date
)
returns public.tanks
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_tank public.tanks%rowtype;
begin
  select * into v_tank from public.tanks where id = p_tank_id;

  if not found then
    raise exception 'The selected tank does not exist.' using errcode = 'foreign_key_violation';
  end if;

  if v_tank.station_id <> p_station_id then
    raise exception 'The selected tank belongs to a different station.'
      using errcode = 'foreign_key_violation';
  end if;

  if v_tank.fuel_type_id <> p_fuel_type_id then
    raise exception 'Tank % does not hold the selected fuel grade.', v_tank.code
      using errcode = 'check_violation';
  end if;

  if not v_tank.is_active or v_tank.status <> 'operational' then
    raise exception 'Tank % is not in service.', v_tank.code
      using errcode = 'check_violation';
  end if;

  if p_business_date > current_date then
    raise exception 'A record cannot be dated in the future.' using errcode = 'check_violation';
  end if;

  return v_tank;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deliveries
-- ---------------------------------------------------------------------------
create table public.deliveries (
  id             uuid primary key default gen_random_uuid(),
  station_id     uuid        not null references public.stations (id) on delete restrict,
  tank_id        uuid        not null references public.tanks (id) on delete restrict,
  fuel_type_id   uuid        not null references public.fuel_types (id) on delete restrict,
  supplier_id    uuid        references public.suppliers (id) on delete restrict,

  business_date  date        not null,
  shift_id       uuid        not null references public.shifts (id) on delete restrict,
  delivered_at   timestamptz not null default now(),

  quantity       numeric(16, 3) not null check (quantity > 0),
  unit_cost      numeric(14, 4) check (unit_cost >= 0),

  tanker_ref     text,
  driver_name    text,
  reference_no   text,
  -- Optional gauge readings either side of the drop. They let the system flag a
  -- short delivery, but capture is never blocked when they are unavailable.
  meter_before   numeric(16, 3) check (meter_before >= 0),
  meter_after    numeric(16, 3) check (meter_after >= 0),
  notes          text,

  status         public.record_status not null default 'active',
  ledger_txn_id  bigint,

  created_by     uuid        references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  voided_by      uuid        references public.profiles (id) on delete set null,
  voided_at      timestamptz,
  void_reason    text,

  constraint deliveries_meters_ordered check (
    meter_before is null or meter_after is null or meter_after >= meter_before
  )
);

create index deliveries_station_date_idx on public.deliveries (station_id, business_date desc, delivered_at desc);
create index deliveries_tank_idx         on public.deliveries (tank_id, business_date desc);
create index deliveries_supplier_idx     on public.deliveries (supplier_id) where supplier_id is not null;
create index deliveries_created_by_idx   on public.deliveries (created_by);
create unique index deliveries_reference_uq
  on public.deliveries (station_id, supplier_id, reference_no)
  where reference_no is not null and status = 'active';

-- ---------------------------------------------------------------------------
-- Sales / dispensing
-- ---------------------------------------------------------------------------
create table public.sales (
  id             uuid primary key default gen_random_uuid(),
  station_id     uuid        not null references public.stations (id) on delete restrict,
  tank_id        uuid        not null references public.tanks (id) on delete restrict,
  fuel_type_id   uuid        not null references public.fuel_types (id) on delete restrict,

  business_date  date        not null,
  shift_id       uuid        not null references public.shifts (id) on delete restrict,

  quantity       numeric(16, 3) not null check (quantity > 0),
  -- Price snapshot at capture time: a later price change must not retroactively
  -- alter what this shift was worth.
  unit_price     numeric(14, 4) check (unit_price >= 0),
  gross_amount   numeric(16, 2) generated always as (
    round(coalesce(unit_price, 0) * quantity, 2)
  ) stored,

  pump_label     text,
  nozzle_label   text,
  meter_open     numeric(16, 3) check (meter_open >= 0),
  meter_close    numeric(16, 3) check (meter_close >= 0),
  notes          text,

  status         public.record_status not null default 'active',
  ledger_txn_id  bigint,

  created_by     uuid        references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  voided_by      uuid        references public.profiles (id) on delete set null,
  voided_at      timestamptz,
  void_reason    text,

  constraint sales_meters_ordered check (
    meter_open is null or meter_close is null or meter_close >= meter_open
  )
);

create index sales_station_date_idx on public.sales (station_id, business_date desc);
create index sales_tank_period_idx  on public.sales (tank_id, business_date desc, shift_id);
create index sales_fuel_date_idx    on public.sales (fuel_type_id, business_date desc);
create index sales_created_by_idx   on public.sales (created_by);

-- ---------------------------------------------------------------------------
-- Ledger posting
--
-- Posting happens in BEFORE INSERT so the resulting transaction id can be
-- written straight onto the row. Doing it in AFTER INSERT would require the
-- trigger to UPDATE its own table, which the write-once guard rightly forbids.
-- ---------------------------------------------------------------------------
create or replace function public.fn_deliveries_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fn_assert_movement_context(
    new.station_id, new.tank_id, new.fuel_type_id, new.business_date);

  new.created_by := coalesce(new.created_by, auth.uid());

  new.ledger_txn_id := public.fn_post_transaction(
    new.tank_id, 'delivery', new.quantity, new.business_date, new.shift_id,
    'deliveries', new.id,
    nullif(concat_ws(' · ', new.tanker_ref, new.reference_no), ''),
    new.created_by
  );

  return new;
end;
$$;

create or replace function public.fn_sales_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fn_assert_movement_context(
    new.station_id, new.tank_id, new.fuel_type_id, new.business_date);

  new.created_by := coalesce(new.created_by, auth.uid());

  -- Default the price from the current grade price if the operator did not
  -- supply one, so revenue reporting works without extra typing.
  if new.unit_price is null then
    select selling_price into new.unit_price
      from public.fuel_types where id = new.fuel_type_id;
  end if;

  new.ledger_txn_id := public.fn_post_transaction(
    new.tank_id, 'sale', -new.quantity, new.business_date, new.shift_id,
    'sales', new.id,
    nullif(concat_ws('/', new.pump_label, new.nozzle_label), ''),
    new.created_by
  );

  return new;
end;
$$;

-- Voiding is the only mutation, and it reverses rather than deletes.
create or replace function public.fn_movement_void_reversal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'voided' and old.status = 'active' and old.ledger_txn_id is not null then
    perform public.fn_reverse_transaction(
      old.ledger_txn_id,
      initcap(tg_table_name) || ' voided: ' || new.void_reason,
      new.voided_by
    );
  end if;
  return null;
end;
$$;

create trigger trg_deliveries_before_insert
  before insert on public.deliveries
  for each row execute function public.fn_deliveries_before_insert();
create trigger trg_deliveries_guard
  before update on public.deliveries
  for each row execute function public.fn_guard_operational_record();
create trigger trg_deliveries_void
  after update on public.deliveries
  for each row execute function public.fn_movement_void_reversal();
create trigger trg_deliveries_no_delete
  before delete on public.deliveries
  for each row execute function public.fn_block_write();

create trigger trg_sales_before_insert
  before insert on public.sales
  for each row execute function public.fn_sales_before_insert();
create trigger trg_sales_guard
  before update on public.sales
  for each row execute function public.fn_guard_operational_record();
create trigger trg_sales_void
  after update on public.sales
  for each row execute function public.fn_movement_void_reversal();
create trigger trg_sales_no_delete
  before delete on public.sales
  for each row execute function public.fn_block_write();

-- ---------------------------------------------------------------------------
-- Tank readings — physical measurements
--
-- This is the seam for hardware. A dipstick reading typed by a supervisor and
-- an automatic reading pushed by a gauge land in the same table with the same
-- shape; only `source` and `sensor_device_id` differ. The reconciliation engine
-- reads this table and never asks where the number came from.
-- ---------------------------------------------------------------------------
create table public.tank_readings (
  id                uuid primary key default gen_random_uuid(),
  station_id        uuid        not null references public.stations (id) on delete restrict,
  tank_id           uuid        not null references public.tanks (id) on delete restrict,

  reading_type      public.reading_type   not null default 'closing',
  source            public.reading_source not null default 'manual',

  business_date     date        not null,
  shift_id          uuid        references public.shifts (id) on delete restrict,
  reading_at        timestamptz not null default now(),

  quantity          numeric(16, 3) not null check (quantity >= 0),
  -- Richer telemetry, populated by gauges. Manual entry leaves these null.
  level_mm          numeric(12, 2) check (level_mm >= 0),
  temperature_c     numeric(6, 2),
  water_level_mm    numeric(12, 2) check (water_level_mm >= 0),

  sensor_device_id  uuid,
  raw_payload       jsonb,

  recorded_by       uuid        references public.profiles (id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),

  constraint tank_readings_sensor_provenance check (
    (source = 'sensor' and sensor_device_id is not null)
    or (source <> 'sensor' and sensor_device_id is null)
  )
);

create index tank_readings_tank_period_idx
  on public.tank_readings (tank_id, business_date desc, reading_at desc);
create index tank_readings_station_idx
  on public.tank_readings (station_id, reading_at desc);
create index tank_readings_source_idx
  on public.tank_readings (source, reading_at desc);

-- A measurement is a fact about a moment in time; it is never edited.
create trigger trg_tank_readings_immutable
  before update or delete on public.tank_readings
  for each row execute function public.fn_block_write();

create or replace function public.fn_validate_reading()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_tank public.tanks%rowtype;
begin
  select * into v_tank from public.tanks where id = new.tank_id;
  if not found then
    raise exception 'The selected tank does not exist.' using errcode = 'foreign_key_violation';
  end if;

  if v_tank.station_id <> new.station_id then
    raise exception 'The selected tank belongs to a different station.'
      using errcode = 'foreign_key_violation';
  end if;

  if new.quantity > v_tank.capacity then
    raise exception
      'A reading of % units exceeds the % unit capacity of tank %. Check the measurement.',
      new.quantity, v_tank.capacity, v_tank.code
      using errcode = 'check_violation';
  end if;

  if new.source = 'manual' then
    new.recorded_by := coalesce(new.recorded_by, auth.uid());
  end if;

  return new;
end;
$$;

create trigger trg_tank_readings_validate
  before insert on public.tank_readings
  for each row execute function public.fn_validate_reading();

-- ---------------------------------------------------------------------------
-- Adjustments — the only way to change stock outside a delivery or sale
--
-- A supervisor may request one; only a manager can approve it; only an approved
-- adjustment reaches the ledger.
-- ---------------------------------------------------------------------------
create table public.adjustments (
  id               uuid primary key default gen_random_uuid(),
  station_id       uuid        not null references public.stations (id) on delete restrict,
  tank_id          uuid        not null references public.tanks (id) on delete restrict,
  fuel_type_id     uuid        not null references public.fuel_types (id) on delete restrict,

  business_date    date        not null,
  shift_id         uuid        references public.shifts (id) on delete restrict,

  -- Signed: negative writes stock off, positive writes it on.
  quantity_delta   numeric(16, 3) not null check (quantity_delta <> 0),
  reason_code      text        not null,
  reason           text        not null,

  -- Traceability for corrections: what this adjustment is putting right.
  corrects_delivery_id uuid references public.deliveries (id) on delete set null,
  corrects_sale_id     uuid references public.sales (id) on delete set null,

  status           public.adjustment_status not null default 'pending',
  ledger_txn_id    bigint,

  requested_by     uuid        references public.profiles (id) on delete set null,
  requested_at     timestamptz not null default now(),
  decided_by       uuid        references public.profiles (id) on delete set null,
  decided_at       timestamptz,
  decision_note    text,

  constraint adjustments_reason_len check (char_length(btrim(reason)) >= 5)
);

create index adjustments_station_status_idx on public.adjustments (station_id, status, requested_at desc);
create index adjustments_tank_idx           on public.adjustments (tank_id, business_date desc);
create index adjustments_pending_idx        on public.adjustments (station_id) where status = 'pending';

create or replace function public.fn_adjustments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fn_assert_movement_context(
    new.station_id, new.tank_id, new.fuel_type_id, new.business_date);

  new.requested_by := coalesce(new.requested_by, auth.uid());
  new.status       := 'pending';  -- an adjustment can never be born approved
  new.decided_by   := null;
  new.decided_at   := null;
  new.ledger_txn_id := null;

  return new;
end;
$$;

create or replace function public.fn_adjustment_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'pending' then
    raise exception 'This adjustment has already been decided and cannot change.'
      using errcode = 'restrict_violation';
  end if;

  if new.status = 'pending' then
    raise exception 'A pending adjustment can only be approved or rejected.'
      using errcode = 'restrict_violation';
  end if;

  if not public.app_is_manager() then
    raise exception 'Only a manager can approve or reject an adjustment.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Freeze the request: a decision must not alter what was asked for.
  new.tank_id        := old.tank_id;
  new.fuel_type_id   := old.fuel_type_id;
  new.quantity_delta := old.quantity_delta;
  new.reason         := old.reason;
  new.reason_code    := old.reason_code;
  new.business_date  := old.business_date;
  new.shift_id       := old.shift_id;
  new.requested_by   := old.requested_by;
  new.requested_at   := old.requested_at;

  new.decided_by := coalesce(new.decided_by, auth.uid());
  new.decided_at := coalesce(new.decided_at, now());

  if new.status = 'approved' then
    new.ledger_txn_id := public.fn_post_transaction(
      new.tank_id, 'adjustment', new.quantity_delta, new.business_date, new.shift_id,
      'adjustments', new.id, new.reason_code || ': ' || new.reason, new.decided_by
    );
  end if;

  return new;
end;
$$;

create trigger trg_adjustments_before_insert
  before insert on public.adjustments
  for each row execute function public.fn_adjustments_before_insert();

create trigger trg_adjustments_decision
  before update on public.adjustments
  for each row execute function public.fn_adjustment_decision();

create trigger trg_adjustments_no_delete
  before delete on public.adjustments
  for each row execute function public.fn_block_write();
