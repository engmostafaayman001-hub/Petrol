-- ===========================================================================
-- 0006 · RECONCILIATION ENGINE
--
-- A reconciliation session covers exactly one accounting period
-- (business_date + shift) and holds one line per operational tank.
--
--   expected closing = opening + deliveries - sales + approved adjustments
--   variance         = actual closing - expected closing
--
-- Every input is derived from the ledger at compute time. Nothing is typed
-- twice and nothing can be nudged by hand: the only value a human supplies is
-- the physical measurement.
-- ===========================================================================

create table public.reconciliation_sessions (
  id             uuid primary key default gen_random_uuid(),
  station_id     uuid        not null references public.stations (id) on delete restrict,
  business_date  date        not null,
  shift_id       uuid        not null references public.shifts (id) on delete restrict,
  shift_seq      smallint    not null,

  status         public.reconciliation_status not null default 'open',

  -- Roll-ups written by the engine. Historical reports read these instead of
  -- re-aggregating the ledger for every period they display.
  total_opening    numeric(16, 3) not null default 0,
  total_delivered  numeric(16, 3) not null default 0,
  total_sold       numeric(16, 3) not null default 0,
  total_adjusted   numeric(16, 3) not null default 0,
  total_expected   numeric(16, 3) not null default 0,
  total_actual     numeric(16, 3) not null default 0,
  total_variance   numeric(16, 3) not null default 0,
  worst_status     public.variance_status not null default 'balanced',

  opened_by      uuid        references public.profiles (id) on delete set null,
  opened_at      timestamptz not null default now(),
  submitted_by   uuid        references public.profiles (id) on delete set null,
  submitted_at   timestamptz,
  reviewed_by    uuid        references public.profiles (id) on delete set null,
  reviewed_at    timestamptz,
  review_note    text,
  notes          text,

  unique (station_id, business_date, shift_id)
);

create index recon_sessions_station_idx
  on public.reconciliation_sessions (station_id, business_date desc, shift_seq desc);
create index recon_sessions_open_idx
  on public.reconciliation_sessions (station_id, status)
  where status in ('open', 'submitted');

create table public.reconciliation_lines (
  id                   uuid primary key default gen_random_uuid(),
  session_id           uuid        not null references public.reconciliation_sessions (id) on delete cascade,
  station_id           uuid        not null references public.stations (id) on delete restrict,
  tank_id              uuid        not null references public.tanks (id) on delete restrict,
  fuel_type_id         uuid        not null references public.fuel_types (id) on delete restrict,

  -- Derived from the ledger; refreshed until the session is submitted.
  opening_qty          numeric(16, 3) not null default 0,
  delivered_qty        numeric(16, 3) not null default 0,
  sold_qty             numeric(16, 3) not null default 0,
  adjusted_qty         numeric(16, 3) not null default 0,
  expected_closing_qty numeric(16, 3) not null default 0,

  -- The one human (or sensor) input.
  actual_closing_qty   numeric(16, 3) check (actual_closing_qty >= 0),
  closing_reading_id   uuid references public.tank_readings (id) on delete set null,
  reading_source       public.reading_source,

  variance_qty         numeric(16, 3),
  variance_pct         numeric(10, 4),
  variance_status      public.variance_status,

  writeoff_txn_id      bigint,
  notes                text,

  computed_at          timestamptz not null default now(),

  unique (session_id, tank_id)
);

create index recon_lines_session_idx on public.reconciliation_lines (session_id);
create index recon_lines_tank_idx    on public.reconciliation_lines (tank_id);
create index recon_lines_variance_idx
  on public.reconciliation_lines (station_id, variance_status)
  where variance_status in ('warning', 'critical');

-- ---------------------------------------------------------------------------
-- Engine mode
--
-- The immutability guards below refuse writes to derived columns. The engine
-- itself must be able to write them, so its SECURITY DEFINER functions raise a
-- transaction-local flag that the guards honour. Only these functions can set
-- it, and it dies with the transaction.
-- ---------------------------------------------------------------------------
create or replace function public.fn_engine_on()
returns void
language sql
as $$ select set_config('app.engine', 'on', true)::void $$;

create or replace function public.fn_engine_active()
returns boolean
language sql
stable
as $$ select coalesce(current_setting('app.engine', true), '') = 'on' $$;

-- ---------------------------------------------------------------------------
-- Variance classification
--
-- Bands come from system_settings so a manager can retune tolerance without a
-- deployment. The absolute tolerance is a dead band: it stops a 2 litre
-- rounding difference on a nearly-empty tank being reported as a 40% disaster.
-- ---------------------------------------------------------------------------
create or replace function public.fn_variance_pct(p_variance numeric, p_expected numeric)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_expected, 0) = 0 then
      case when coalesce(p_variance, 0) = 0 then 0 else 100 end
    else round(coalesce(p_variance, 0) / abs(p_expected) * 100, 4)
  end;
$$;

create or replace function public.fn_classify_variance(
  p_station_id uuid,
  p_variance   numeric,
  p_expected   numeric
)
returns public.variance_status
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s   public.system_settings%rowtype;
  pct numeric;
begin
  select * into s from public.system_settings where station_id = p_station_id;

  if abs(coalesce(p_variance, 0)) <= coalesce(s.variance_abs_tolerance, 0) then
    return 'balanced';
  end if;

  pct := abs(public.fn_variance_pct(p_variance, p_expected));

  if pct <= s.variance_minor_pct   then return 'minor';   end if;
  if pct <= s.variance_warning_pct then return 'warning'; end if;
  return 'critical';
end;
$$;

-- Severity ordering for the enum, used to pick a session's worst line.
create or replace function public.fn_variance_rank(p public.variance_status)
returns smallint
language sql
immutable
as $$
  select case p
    when 'critical' then 4 when 'warning' then 3
    when 'minor' then 2 when 'balanced' then 1 else 0 end::smallint;
$$;

-- ---------------------------------------------------------------------------
-- fn_open_reconciliation
--
-- Idempotent: calling it again for the same period returns the existing
-- session. Creates one line per operational tank and seeds it from the ledger.
-- ---------------------------------------------------------------------------
create or replace function public.fn_open_reconciliation(
  p_station_id    uuid,
  p_business_date date,
  p_shift_id      uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_id uuid;
  v_seq        smallint;
begin
  if not public.app_owns(p_station_id) then
    raise exception 'You do not have access to this station.' using errcode = 'insufficient_privilege';
  end if;

  select seq into v_seq
    from public.shifts
   where id = p_shift_id and station_id = p_station_id and is_active;

  if v_seq is null then
    raise exception 'The selected shift is not available at this station.'
      using errcode = 'foreign_key_violation';
  end if;

  if p_business_date > current_date then
    raise exception 'A reconciliation cannot be opened for a future date.'
      using errcode = 'check_violation';
  end if;

  select id into v_session_id
    from public.reconciliation_sessions
   where station_id = p_station_id
     and business_date = p_business_date
     and shift_id = p_shift_id;

  if v_session_id is null then
    insert into public.reconciliation_sessions
      (station_id, business_date, shift_id, shift_seq, opened_by)
    values
      (p_station_id, p_business_date, p_shift_id, v_seq, auth.uid())
    returning id into v_session_id;
  end if;

  -- Pick up any tank that entered service since the session was opened.
  insert into public.reconciliation_lines (session_id, station_id, tank_id, fuel_type_id)
  select v_session_id, t.station_id, t.id, t.fuel_type_id
    from public.tanks t
   where t.station_id = p_station_id
     and t.is_active
     and t.status = 'operational'
  on conflict (session_id, tank_id) do nothing;

  perform public.fn_recompute_reconciliation(v_session_id);
  return v_session_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- fn_recompute_reconciliation
--
-- Re-derives every line from the ledger. Safe to call as often as the UI likes
-- while the session is open; a no-op once submitted, so a frozen period can
-- never shift under a manager's feet.
-- ---------------------------------------------------------------------------
create or replace function public.fn_recompute_reconciliation(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.reconciliation_sessions%rowtype;
  l record;
  m record;
  v_opening  numeric;
  v_expected numeric;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id;
  if not found then
    raise exception 'Reconciliation not found.' using errcode = 'no_data_found';
  end if;

  if s.status <> 'open' then
    return;
  end if;

  perform public.fn_engine_on();

  for l in select * from public.reconciliation_lines where session_id = p_session_id
  loop
    v_opening := public.fn_period_opening(l.tank_id, s.business_date, s.shift_seq);

    select * into m from public.fn_period_movements(l.tank_id, s.business_date, s.shift_seq);

    v_expected := public.fn_vol(v_opening + m.delivered - m.sold + m.adjusted);

    update public.reconciliation_lines
       set opening_qty          = v_opening,
           delivered_qty        = m.delivered,
           sold_qty             = m.sold,
           adjusted_qty         = m.adjusted,
           expected_closing_qty = v_expected,
           variance_qty = case when l.actual_closing_qty is null then null
                               else public.fn_vol(l.actual_closing_qty - v_expected) end,
           variance_pct = case when l.actual_closing_qty is null then null
                               else public.fn_variance_pct(l.actual_closing_qty - v_expected, v_expected) end,
           variance_status = case when l.actual_closing_qty is null then null
                                  else public.fn_classify_variance(
                                         l.station_id, l.actual_closing_qty - v_expected, v_expected) end,
           computed_at = now()
     where id = l.id;
  end loop;

  update public.reconciliation_sessions t
     set total_opening   = agg.opening,
         total_delivered = agg.delivered,
         total_sold      = agg.sold,
         total_adjusted  = agg.adjusted,
         total_expected  = agg.expected,
         total_actual    = agg.actual,
         total_variance  = agg.variance,
         worst_status    = agg.worst
    from (
      select
        public.fn_vol(coalesce(sum(opening_qty), 0))          as opening,
        public.fn_vol(coalesce(sum(delivered_qty), 0))        as delivered,
        public.fn_vol(coalesce(sum(sold_qty), 0))             as sold,
        public.fn_vol(coalesce(sum(adjusted_qty), 0))         as adjusted,
        public.fn_vol(coalesce(sum(expected_closing_qty), 0)) as expected,
        public.fn_vol(coalesce(sum(actual_closing_qty), 0))   as actual,
        public.fn_vol(coalesce(sum(variance_qty), 0))         as variance,
        coalesce(
          (select rl.variance_status
             from public.reconciliation_lines rl
            where rl.session_id = p_session_id and rl.variance_status is not null
            order by public.fn_variance_rank(rl.variance_status) desc
            limit 1),
          'balanced'
        ) as worst
      from public.reconciliation_lines
     where session_id = p_session_id
    ) agg
   where t.id = p_session_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- fn_record_closing_measurement
--
-- THE SENSOR SEAM. Manual dip readings and automatic gauge readings both enter
-- through this one function; nothing downstream branches on p_source.
-- ---------------------------------------------------------------------------
create or replace function public.fn_record_closing_measurement(
  p_session_id       uuid,
  p_tank_id          uuid,
  p_quantity         numeric,
  p_source           public.reading_source default 'manual',
  p_sensor_device_id uuid default null,
  p_notes            text default null,
  p_raw              jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s         public.reconciliation_sessions%rowtype;
  v_reading uuid;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id;
  if not found then
    raise exception 'Reconciliation not found.' using errcode = 'no_data_found';
  end if;

  if not public.app_owns(s.station_id) then
    raise exception 'You do not have access to this station.' using errcode = 'insufficient_privilege';
  end if;

  if s.status <> 'open' then
    raise exception 'This reconciliation has already been submitted and can no longer be changed.'
      using errcode = 'restrict_violation';
  end if;

  if not exists (select 1 from public.reconciliation_lines
                  where session_id = p_session_id and tank_id = p_tank_id) then
    raise exception 'That tank is not part of this reconciliation.'
      using errcode = 'foreign_key_violation';
  end if;

  -- Only a trusted server-side caller (the sensor gateway) may claim a reading
  -- came from hardware. A browser session can only ever record a manual dip.
  if p_source <> 'manual' and public.app_jwt_role() <> 'service_role' then
    raise exception 'Only the sensor gateway can record an automatic reading.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.tank_readings (
    station_id, tank_id, reading_type, source, business_date, shift_id,
    quantity, sensor_device_id, raw_payload, notes
  ) values (
    s.station_id, p_tank_id, 'closing', p_source, s.business_date, s.shift_id,
    p_quantity, p_sensor_device_id, p_raw, p_notes
  )
  returning id into v_reading;

  perform public.fn_engine_on();

  update public.reconciliation_lines
     set actual_closing_qty = public.fn_vol(p_quantity),
         closing_reading_id = v_reading,
         reading_source     = p_source,
         notes              = coalesce(nullif(btrim(p_notes), ''), notes)
   where session_id = p_session_id and tank_id = p_tank_id;

  perform public.fn_recompute_reconciliation(p_session_id);
  return v_reading;
end;
$$;

-- ---------------------------------------------------------------------------
-- fn_submit_reconciliation
--
-- Freezes the period. Afterwards no user of any role can edit it; corrections
-- go through an adjustment, which is separately auditable.
-- ---------------------------------------------------------------------------
create or replace function public.fn_submit_reconciliation(
  p_session_id uuid,
  p_notes      text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s         public.reconciliation_sessions%rowtype;
  settings  public.system_settings%rowtype;
  v_missing text;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Reconciliation not found.' using errcode = 'no_data_found';
  end if;

  if not public.app_owns(s.station_id) then
    raise exception 'You do not have access to this station.' using errcode = 'insufficient_privilege';
  end if;

  if s.status <> 'open' then
    raise exception 'This reconciliation has already been submitted.'
      using errcode = 'restrict_violation';
  end if;

  select * into settings from public.system_settings where station_id = s.station_id;

  perform public.fn_recompute_reconciliation(p_session_id);

  select string_agg(t.code, ', ' order by t.code) into v_missing
    from public.reconciliation_lines rl
    join public.tanks t on t.id = rl.tank_id
   where rl.session_id = p_session_id and rl.actual_closing_qty is null;

  if v_missing is not null then
    raise exception 'A closing measurement is still missing for: %.', v_missing
      using errcode = 'check_violation';
  end if;

  -- A variance beyond the critical band must be explained in writing before the
  -- period can be closed.
  select string_agg(t.code, ', ' order by t.code) into v_missing
    from public.reconciliation_lines rl
    join public.tanks t on t.id = rl.tank_id
   where rl.session_id = p_session_id
     and abs(coalesce(rl.variance_pct, 0)) > settings.variance_critical_pct
     and coalesce(btrim(rl.notes), '') = '';

  if v_missing is not null then
    raise exception
      'Tank(s) % show a variance beyond the critical threshold. Add an explanation before submitting.',
      v_missing using errcode = 'check_violation';
  end if;

  if coalesce(settings.post_variance_on_submit, true) then
    perform public.fn_post_reconciliation_variance(p_session_id, auth.uid());
  end if;

  perform public.fn_engine_on();

  update public.reconciliation_sessions
     set status       = 'submitted',
         submitted_by = auth.uid(),
         submitted_at = now(),
         notes        = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = p_session_id;
end;
$$;

-- Brings the ledger into line with what was physically measured by posting the
-- difference as an explicit, attributable movement. Stock is never overwritten.
create or replace function public.fn_post_reconciliation_variance(
  p_session_id uuid,
  p_actor      uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s     public.reconciliation_sessions%rowtype;
  l     record;
  v_txn bigint;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id;

  perform public.fn_engine_on();

  for l in
    select * from public.reconciliation_lines
     where session_id = p_session_id
       and variance_qty is not null
       and variance_qty <> 0
       and writeoff_txn_id is null
  loop
    v_txn := public.fn_post_transaction(
      l.tank_id, 'variance_writeoff', l.variance_qty, s.business_date, s.shift_id,
      'reconciliation_lines', l.id,
      'Measured variance recorded at reconciliation', p_actor
    );
    update public.reconciliation_lines set writeoff_txn_id = v_txn where id = l.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- fn_review_reconciliation — manager sign-off
-- ---------------------------------------------------------------------------
create or replace function public.fn_review_reconciliation(
  p_session_id uuid,
  p_approve    boolean,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s        public.reconciliation_sessions%rowtype;
  settings public.system_settings%rowtype;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Reconciliation not found.' using errcode = 'no_data_found';
  end if;

  if not public.app_is_manager() or not public.app_owns(s.station_id) then
    raise exception 'Only a manager can review a reconciliation.'
      using errcode = 'insufficient_privilege';
  end if;

  if s.status <> 'submitted' then
    raise exception 'Only a submitted reconciliation can be reviewed.'
      using errcode = 'restrict_violation';
  end if;

  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'Explain why the reconciliation is being rejected.'
      using errcode = 'check_violation';
  end if;

  select * into settings from public.system_settings where station_id = s.station_id;

  if p_approve and not coalesce(settings.post_variance_on_submit, true) then
    perform public.fn_post_reconciliation_variance(p_session_id, auth.uid());
  end if;

  perform public.fn_engine_on();

  update public.reconciliation_sessions
     set status      = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = p_note
   where id = p_session_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Immutability guards
--
-- Belt and braces alongside RLS. Even a manager cannot hand-edit a submitted
-- period through the REST API, and nobody can hand-edit a derived column.
-- ---------------------------------------------------------------------------
create or replace function public.fn_guard_reconciliation_session()
returns trigger
language plpgsql
as $$
begin
  if public.fn_engine_active() then
    return new;
  end if;

  if old.status <> 'open' then
    raise exception 'This reconciliation is final. Raise an adjustment to correct it.'
      using errcode = 'restrict_violation';
  end if;

  -- Outside the engine, only free-text notes may be written on an open session.
  new.status         := old.status;
  new.shift_id       := old.shift_id;
  new.business_date  := old.business_date;
  new.total_opening  := old.total_opening;
  new.total_delivered:= old.total_delivered;
  new.total_sold     := old.total_sold;
  new.total_adjusted := old.total_adjusted;
  new.total_expected := old.total_expected;
  new.total_actual   := old.total_actual;
  new.total_variance := old.total_variance;
  new.worst_status   := old.worst_status;
  new.submitted_by   := old.submitted_by;
  new.submitted_at   := old.submitted_at;
  new.reviewed_by    := old.reviewed_by;
  new.reviewed_at    := old.reviewed_at;

  return new;
end;
$$;

create or replace function public.fn_guard_reconciliation_line()
returns trigger
language plpgsql
as $$
declare v_status public.reconciliation_status;
begin
  if public.fn_engine_active() then
    return new;
  end if;

  select status into v_status
    from public.reconciliation_sessions where id = old.session_id;

  if v_status <> 'open' then
    raise exception 'This reconciliation has been submitted; its lines are final.'
      using errcode = 'restrict_violation';
  end if;

  -- Every figure on a line is owned by the engine. A supervisor annotating a
  -- variance may write `notes` and nothing else.
  new.opening_qty          := old.opening_qty;
  new.delivered_qty        := old.delivered_qty;
  new.sold_qty             := old.sold_qty;
  new.adjusted_qty         := old.adjusted_qty;
  new.expected_closing_qty := old.expected_closing_qty;
  new.variance_qty         := old.variance_qty;
  new.variance_pct         := old.variance_pct;
  new.variance_status      := old.variance_status;
  new.writeoff_txn_id      := old.writeoff_txn_id;
  new.actual_closing_qty   := old.actual_closing_qty;
  new.closing_reading_id   := old.closing_reading_id;
  new.reading_source       := old.reading_source;
  new.tank_id              := old.tank_id;
  new.session_id           := old.session_id;

  return new;
end;
$$;

create trigger trg_recon_sessions_guard
  before update on public.reconciliation_sessions
  for each row execute function public.fn_guard_reconciliation_session();

create trigger trg_recon_lines_guard
  before update on public.reconciliation_lines
  for each row execute function public.fn_guard_reconciliation_line();

create trigger trg_recon_lines_no_delete
  before delete on public.reconciliation_lines
  for each row execute function public.fn_block_write();
