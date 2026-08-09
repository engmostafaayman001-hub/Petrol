-- ===========================================================================
-- 0007 · AUDIT TRAIL, ALERTS AND THE SENSOR SEAM
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Audit log
--
-- Written by a database trigger rather than by application code, so an action
-- is logged no matter which client performed it — the web app, a direct REST
-- call, or a future integration. Append-only for every role.
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id             bigint generated always as identity primary key,
  station_id     uuid,
  actor_id       uuid,
  actor_role     public.user_role,
  action         text        not null check (action in ('create', 'update', 'delete')),
  entity         text        not null,
  entity_id      text,
  entity_label   text,
  changed_fields text[],
  before_state   jsonb,
  after_state    jsonb,
  reason         text,
  created_at     timestamptz not null default now()
);

create index audit_logs_station_time_idx on public.audit_logs (station_id, created_at desc);
create index audit_logs_entity_idx       on public.audit_logs (entity, entity_id, created_at desc);
create index audit_logs_actor_idx        on public.audit_logs (actor_id, created_at desc);

create trigger trg_audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.fn_block_write();

comment on table public.audit_logs is
  'Append-only audit trail. Immutable for every role including service_role.';

-- Fields that add noise without adding accountability.
create or replace function public.fn_audit_ignored_fields()
returns text[]
language sql
immutable
as $$ select array['updated_at', 'computed_at', 'last_seen_at', 'raw_payload'] $$;

create or replace function public.fn_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before  jsonb;
  v_after   jsonb;
  v_changed text[];
  v_station uuid;
  v_label   text;
  v_reason  text;
  v_action  text;
begin
  if tg_op = 'INSERT' then
    v_action := 'create';  v_after  := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'update';  v_before := to_jsonb(old);  v_after := to_jsonb(new);
  else
    v_action := 'delete';  v_before := to_jsonb(old);
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key order by key), '{}')
      into v_changed
      from jsonb_each(v_after) e(key, value)
     where v_before -> e.key is distinct from e.value
       and not (e.key = any (public.fn_audit_ignored_fields()));

    -- Nothing of substance changed; do not create an empty audit entry.
    if v_changed = '{}' then
      return null;
    end if;
  end if;

  v_station := coalesce(v_after ->> 'station_id', v_before ->> 'station_id')::uuid;
  if v_station is null and tg_table_name = 'stations' then
    v_station := coalesce(v_after ->> 'id', v_before ->> 'id')::uuid;
  end if;

  -- A human-readable handle so the audit screen does not show bare UUIDs.
  v_label := coalesce(
    v_after ->> 'code',      v_before ->> 'code',
    v_after ->> 'name',      v_before ->> 'name',
    v_after ->> 'full_name', v_before ->> 'full_name',
    v_after ->> 'reference_no'
  );

  v_reason := coalesce(
    v_after ->> 'void_reason',
    v_after ->> 'decision_note',
    v_after ->> 'review_note',
    v_after ->> 'reason'
  );

  insert into public.audit_logs (
    station_id, actor_id, actor_role, action, entity, entity_id, entity_label,
    changed_fields, before_state, after_state, reason
  ) values (
    v_station,
    auth.uid(),
    public.app_role(),
    v_action,
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id'),
    v_label,
    v_changed,
    v_before,
    v_after,
    v_reason
  );

  return null;
end;
$$;

create trigger trg_audit_stations     after insert or update or delete on public.stations
  for each row execute function public.fn_audit();
create trigger trg_audit_profiles     after insert or update or delete on public.profiles
  for each row execute function public.fn_audit();
create trigger trg_audit_settings     after update on public.system_settings
  for each row execute function public.fn_audit();
create trigger trg_audit_shifts       after insert or update or delete on public.shifts
  for each row execute function public.fn_audit();
create trigger trg_audit_fuel_types   after insert or update or delete on public.fuel_types
  for each row execute function public.fn_audit();
create trigger trg_audit_suppliers    after insert or update or delete on public.suppliers
  for each row execute function public.fn_audit();
create trigger trg_audit_tanks        after insert or update or delete on public.tanks
  for each row execute function public.fn_audit();
create trigger trg_audit_deliveries   after insert or update on public.deliveries
  for each row execute function public.fn_audit();
create trigger trg_audit_sales        after insert or update on public.sales
  for each row execute function public.fn_audit();
create trigger trg_audit_adjustments  after insert or update on public.adjustments
  for each row execute function public.fn_audit();
create trigger trg_audit_recon        after insert or update on public.reconciliation_sessions
  for each row execute function public.fn_audit();
create trigger trg_audit_readings     after insert on public.tank_readings
  for each row execute function public.fn_audit();

-- ---------------------------------------------------------------------------
-- Notifications
--
-- Deliberately sparse. An alert only exists while the condition holds; when the
-- tank is refilled the alert is resolved rather than duplicated. `dedupe_key`
-- plus a partial unique index keeps exactly one open alert per condition.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id           bigint generated always as identity primary key,
  station_id   uuid        not null references public.stations (id) on delete cascade,
  kind         public.notification_kind      not null,
  severity     public.notification_severity  not null default 'info',
  title        text        not null,
  body         text,
  entity       text,
  entity_id    text,
  -- Null targets everyone; otherwise only this role sees it.
  target_role  public.user_role,
  dedupe_key   text        not null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

create unique index notifications_open_uq
  on public.notifications (station_id, dedupe_key)
  where resolved_at is null;

create index notifications_feed_idx
  on public.notifications (station_id, created_at desc)
  where resolved_at is null;

create table public.notification_reads (
  notification_id bigint not null references public.notifications (id) on delete cascade,
  profile_id      uuid   not null references public.profiles (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, profile_id)
);

create or replace function public.fn_raise_notification(
  p_station_id uuid,
  p_kind       public.notification_kind,
  p_severity   public.notification_severity,
  p_title      text,
  p_body       text,
  p_dedupe_key text,
  p_entity     text default null,
  p_entity_id  text default null,
  p_target     public.user_role default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications
    (station_id, kind, severity, title, body, dedupe_key, entity, entity_id, target_role)
  values
    (p_station_id, p_kind, p_severity, p_title, p_body, p_dedupe_key, p_entity, p_entity_id, p_target)
  on conflict (station_id, dedupe_key) where resolved_at is null do nothing;
end;
$$;

create or replace function public.fn_resolve_notification(p_station_id uuid, p_dedupe_key text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.notifications
     set resolved_at = now()
   where station_id = p_station_id and dedupe_key = p_dedupe_key and resolved_at is null;
$$;

-- Level alerts are evaluated on the tank that just moved, so the cost is O(1)
-- per transaction rather than a periodic sweep of every tank.
create or replace function public.fn_evaluate_tank_alerts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t        public.tanks%rowtype;
  s        public.system_settings%rowtype;
  v_qty    numeric;
  v_pct    numeric;
  k_low    text;
  k_high   text;
begin
  select * into t from public.tanks where id = new.tank_id;
  select * into s from public.system_settings where station_id = new.station_id;
  select quantity into v_qty from public.tank_balances where tank_id = new.tank_id;

  v_pct  := case when t.capacity > 0 then v_qty / t.capacity * 100 else 0 end;
  k_low  := 'tank_low:'  || t.id::text;
  k_high := 'tank_high:' || t.id::text;

  if v_qty <= t.min_safe_level or v_pct <= s.tank_low_level_pct then
    perform public.fn_raise_notification(
      t.station_id, 'tank_below_minimum', 'critical',
      t.code || ' is below its minimum safe level',
      'Stock is ' || public.fn_vol(v_qty) || ' against a minimum of ' || t.min_safe_level || '. Schedule a delivery.',
      k_low, 'tanks', t.id::text);
  else
    perform public.fn_resolve_notification(t.station_id, k_low);
  end if;

  if v_pct >= s.tank_high_level_pct then
    perform public.fn_raise_notification(
      t.station_id, 'tank_near_capacity', 'warning',
      t.code || ' is approaching capacity',
      'Stock is at ' || round(v_pct, 1) || '% of capacity. Confirm ullage before the next drop.',
      k_high, 'tanks', t.id::text);
  else
    perform public.fn_resolve_notification(t.station_id, k_high);
  end if;

  return null;
end;
$$;

create trigger trg_tank_alerts
  after insert on public.inventory_transactions
  for each row execute function public.fn_evaluate_tank_alerts();

-- A variance outside the acceptable bands is escalated to the manager.
create or replace function public.fn_variance_alert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.tanks%rowtype;
begin
  if new.variance_status is distinct from old.variance_status
     and new.variance_status in ('warning', 'critical') then
    select * into t from public.tanks where id = new.tank_id;

    perform public.fn_raise_notification(
      new.station_id, 'large_variance',
      case when new.variance_status = 'critical' then 'critical' else 'warning' end,
      t.code || ' shows a ' || round(new.variance_pct, 2) || '% variance',
      'Expected ' || new.expected_closing_qty || ', measured ' || new.actual_closing_qty || '.',
      'variance:' || new.id::text, 'reconciliation_lines', new.id::text, 'manager');
  end if;
  return null;
end;
$$;

create trigger trg_variance_alert
  after update on public.reconciliation_lines
  for each row execute function public.fn_variance_alert();

-- ---------------------------------------------------------------------------
-- Sensor devices — registry only
--
-- Nothing in v1 writes to this table: readings are entered by hand. It exists
-- so that when gauges are fitted, the only new code is a provider adapter that
-- calls fn_ingest_sensor_reading(). The inventory engine, the reconciliation
-- engine and the dashboard are already source-agnostic.
-- ---------------------------------------------------------------------------
create table public.sensor_devices (
  id             uuid primary key default gen_random_uuid(),
  station_id     uuid        not null references public.stations (id) on delete cascade,
  tank_id        uuid        references public.tanks (id) on delete set null,

  name           text        not null,
  -- Selects the adapter in src/core/sensors/registry.ts. Adding a manufacturer
  -- means registering a provider, not changing the schema.
  provider_key   text        not null,
  external_id    text        not null,
  protocol       text,

  status         public.sensor_status not null default 'unconfigured',
  is_active      boolean     not null default false,

  last_seen_at        timestamptz,
  last_reading_qty    numeric(16, 3),
  last_reading_at     timestamptz,
  -- Readings older than this mark the device offline.
  heartbeat_timeout_s integer not null default 900 check (heartbeat_timeout_s > 0),

  config         jsonb       not null default '{}'::jsonb,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (station_id, provider_key, external_id)
);

create index sensor_devices_tank_idx on public.sensor_devices (tank_id);

create trigger trg_sensor_devices_touch
  before update on public.sensor_devices
  for each row execute function public.fn_touch_updated_at();

create trigger trg_audit_sensor_devices
  after insert or update or delete on public.sensor_devices
  for each row execute function public.fn_audit();

alter table public.tank_readings
  add constraint tank_readings_device_fk
  foreign key (sensor_device_id) references public.sensor_devices (id) on delete set null;

-- ---------------------------------------------------------------------------
-- fn_ingest_sensor_reading
--
-- The future hardware entry point. Called by the sensor gateway route with a
-- service-role connection; validates the device, records a spot reading through
-- exactly the same table manual readings use, and refreshes device health.
--
-- Deliberately does NOT touch the ledger: a gauge reading is an observation,
-- not a movement. It becomes a variance only when a reconciliation adopts it.
-- ---------------------------------------------------------------------------
create or replace function public.fn_ingest_sensor_reading(
  p_provider_key text,
  p_external_id  text,
  p_quantity     numeric,
  p_reading_at   timestamptz default now(),
  p_level_mm     numeric default null,
  p_temperature_c numeric default null,
  p_water_level_mm numeric default null,
  p_raw          jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d         public.sensor_devices%rowtype;
  v_reading uuid;
begin
  select * into d
    from public.sensor_devices
   where provider_key = p_provider_key and external_id = p_external_id;

  if not found then
    raise exception 'Unknown sensor device %/%.', p_provider_key, p_external_id
      using errcode = 'no_data_found';
  end if;

  if not d.is_active or d.status = 'disabled' then
    raise exception 'Sensor % is not enabled.', d.name using errcode = 'check_violation';
  end if;

  if d.tank_id is null then
    raise exception 'Sensor % is not assigned to a tank.', d.name
      using errcode = 'check_violation';
  end if;

  insert into public.tank_readings (
    station_id, tank_id, reading_type, source, business_date, reading_at,
    quantity, level_mm, temperature_c, water_level_mm, sensor_device_id, raw_payload
  ) values (
    d.station_id, d.tank_id, 'spot', 'sensor', (p_reading_at at time zone 'UTC')::date, p_reading_at,
    p_quantity, p_level_mm, p_temperature_c, p_water_level_mm, d.id, p_raw
  )
  returning id into v_reading;

  update public.sensor_devices
     set last_seen_at     = now(),
         last_reading_qty = public.fn_vol(p_quantity),
         last_reading_at  = p_reading_at,
         status           = 'online'
   where id = d.id;

  perform public.fn_resolve_notification(d.station_id, 'sensor_offline:' || d.id::text);

  return v_reading;
end;
$$;

comment on function public.fn_ingest_sensor_reading is
  'Future hardware entry point. Records a gauge observation; never posts to the ledger.';
