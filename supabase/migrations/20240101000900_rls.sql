-- ===========================================================================
-- 0009 · ROW LEVEL SECURITY
--
-- Authorization lives here. The UI hides buttons for usability; the database
-- decides what is actually possible. Every policy is written so that a
-- supervisor calling the REST API directly with a valid token gets exactly the
-- same answer as a supervisor clicking around the app.
--
-- Two axes:
--   1. Station scoping  — app_owns(station_id)
--   2. Capability       — app_is_manager() for anything configuration-shaped
-- ===========================================================================

alter table public.units                    enable row level security;
alter table public.stations                 enable row level security;
alter table public.profiles                 enable row level security;
alter table public.shifts                   enable row level security;
alter table public.system_settings          enable row level security;
alter table public.fuel_types               enable row level security;
alter table public.fuel_price_history       enable row level security;
alter table public.suppliers                enable row level security;
alter table public.tanks                    enable row level security;
alter table public.tank_balances            enable row level security;
alter table public.inventory_transactions   enable row level security;
alter table public.deliveries               enable row level security;
alter table public.sales                    enable row level security;
alter table public.tank_readings            enable row level security;
alter table public.adjustments              enable row level security;
alter table public.reconciliation_sessions  enable row level security;
alter table public.reconciliation_lines     enable row level security;
alter table public.audit_logs               enable row level security;
alter table public.notifications            enable row level security;
alter table public.notification_reads       enable row level security;
alter table public.sensor_devices           enable row level security;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create policy units_read on public.units
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Stations
-- ---------------------------------------------------------------------------
create policy stations_read on public.stations
  for select to authenticated
  using (public.app_owns(id));

create policy stations_manage on public.stations
  for update to authenticated
  using (public.app_owns(id) and public.app_is_manager())
  with check (public.app_owns(id) and public.app_is_manager());

-- ---------------------------------------------------------------------------
-- Profiles
--
-- Everyone at a station can see their colleagues (records show who captured
-- them). Only a manager may change a role, disable an account or move someone
-- between stations — and fn_guard_profile stops a manager demoting themselves
-- into a station with no manager left.
-- ---------------------------------------------------------------------------
create policy profiles_read on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.app_owns(station_id));

create policy profiles_manager_insert on public.profiles
  for insert to authenticated
  with check (public.app_owns(station_id) and public.app_is_manager());

create policy profiles_manager_update on public.profiles
  for update to authenticated
  using (public.app_owns(station_id) and public.app_is_manager())
  with check (public.app_owns(station_id) and public.app_is_manager());

-- A user may maintain their own contact details but nothing that grants power.
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.fn_guard_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.app_is_manager() then
    -- Self-service edits are limited to contact details.
    new.role       := old.role;
    new.is_active  := old.is_active;
    new.station_id := old.station_id;
    new.created_by := old.created_by;
    return new;
  end if;

  -- A station must always retain at least one active manager, or nobody can
  -- ever restore access.
  if (old.role = 'manager' and new.role <> 'manager')
     or (old.is_active and not new.is_active and old.role = 'manager') then
    if (select count(*) from public.profiles p
         where p.station_id = old.station_id and p.role = 'manager'
           and p.is_active and p.id <> old.id) = 0 then
      raise exception 'This is the last active manager for the station. Promote another manager first.'
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_profiles_guard
  before update on public.profiles
  for each row execute function public.fn_guard_profile();

-- ---------------------------------------------------------------------------
-- Configuration — readable by all, writable by managers only
-- ---------------------------------------------------------------------------
create policy shifts_read on public.shifts
  for select to authenticated using (public.app_owns(station_id));
create policy shifts_write on public.shifts
  for all to authenticated
  using (public.app_owns(station_id) and public.app_is_manager())
  with check (public.app_owns(station_id) and public.app_is_manager());

create policy settings_read on public.system_settings
  for select to authenticated using (public.app_owns(station_id));
create policy settings_write on public.system_settings
  for update to authenticated
  using (public.app_owns(station_id) and public.app_is_manager())
  with check (public.app_owns(station_id) and public.app_is_manager());

create policy fuel_types_read on public.fuel_types
  for select to authenticated using (public.app_owns(station_id));
create policy fuel_types_write on public.fuel_types
  for all to authenticated
  using (public.app_owns(station_id) and public.app_is_manager())
  with check (public.app_owns(station_id) and public.app_is_manager());

create policy price_history_read on public.fuel_price_history
  for select to authenticated using (public.app_owns(station_id));

create policy suppliers_read on public.suppliers
  for select to authenticated using (public.app_owns(station_id));
create policy suppliers_write on public.suppliers
  for all to authenticated
  using (public.app_owns(station_id) and public.app_is_manager())
  with check (public.app_owns(station_id) and public.app_is_manager());

create policy tanks_read on public.tanks
  for select to authenticated using (public.app_owns(station_id));
create policy tanks_insert on public.tanks
  for insert to authenticated
  with check (public.app_owns(station_id) and public.app_is_manager());
create policy tanks_update on public.tanks
  for update to authenticated
  using (public.app_owns(station_id) and public.app_is_manager())
  with check (public.app_owns(station_id) and public.app_is_manager());
-- No DELETE policy: tanks are decommissioned, never removed, so their history
-- and their ledger references survive.

create policy tank_balances_read on public.tank_balances
  for select to authenticated using (public.app_owns(station_id));
-- No write policy at all: the balance cache belongs to fn_post_transaction.

-- ---------------------------------------------------------------------------
-- Inventory ledger — readable, never writable through the API
-- ---------------------------------------------------------------------------
create policy ledger_read on public.inventory_transactions
  for select to authenticated using (public.app_owns(station_id));

-- ---------------------------------------------------------------------------
-- Operational capture — both roles may record, only managers may void
-- ---------------------------------------------------------------------------
create policy deliveries_read on public.deliveries
  for select to authenticated using (public.app_owns(station_id));
create policy deliveries_insert on public.deliveries
  for insert to authenticated
  with check (
    public.app_owns(station_id)
    and created_by = auth.uid()
    and status = 'active'
  );
create policy deliveries_void on public.deliveries
  for update to authenticated
  using (public.app_owns(station_id) and public.app_is_manager())
  with check (public.app_owns(station_id) and public.app_is_manager());

create policy sales_read on public.sales
  for select to authenticated using (public.app_owns(station_id));
create policy sales_insert on public.sales
  for insert to authenticated
  with check (
    public.app_owns(station_id)
    and created_by = auth.uid()
    and status = 'active'
  );
create policy sales_void on public.sales
  for update to authenticated
  using (public.app_owns(station_id) and public.app_is_manager())
  with check (public.app_owns(station_id) and public.app_is_manager());

create policy readings_read on public.tank_readings
  for select to authenticated using (public.app_owns(station_id));
create policy readings_insert on public.tank_readings
  for insert to authenticated
  with check (
    public.app_owns(station_id)
    and source = 'manual'          -- only a gateway may claim a sensor origin
    and recorded_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Adjustments — anyone may request, only a manager may decide
-- ---------------------------------------------------------------------------
create policy adjustments_read on public.adjustments
  for select to authenticated using (public.app_owns(station_id));
create policy adjustments_request on public.adjustments
  for insert to authenticated
  with check (
    public.app_owns(station_id)
    and requested_by = auth.uid()
    and status = 'pending'
  );
create policy adjustments_decide on public.adjustments
  for update to authenticated
  using (public.app_owns(station_id) and public.app_is_manager() and status = 'pending')
  with check (public.app_owns(station_id) and public.app_is_manager());

-- ---------------------------------------------------------------------------
-- Reconciliation
--
-- Sessions and lines are created and transitioned exclusively by the engine's
-- SECURITY DEFINER functions. The only direct write the API allows is a
-- free-text note on an open period, and fn_guard_reconciliation_* enforces that.
-- ---------------------------------------------------------------------------
create policy recon_sessions_read on public.reconciliation_sessions
  for select to authenticated using (public.app_owns(station_id));
create policy recon_sessions_note on public.reconciliation_sessions
  for update to authenticated
  using (public.app_owns(station_id) and status = 'open')
  with check (public.app_owns(station_id));

create policy recon_lines_read on public.reconciliation_lines
  for select to authenticated using (public.app_owns(station_id));
create policy recon_lines_note on public.reconciliation_lines
  for update to authenticated
  using (public.app_owns(station_id))
  with check (public.app_owns(station_id));

-- ---------------------------------------------------------------------------
-- Audit trail — managers read, nobody writes
-- ---------------------------------------------------------------------------
create policy audit_read on public.audit_logs
  for select to authenticated
  using (public.app_owns(station_id) and public.app_is_manager());

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create policy notifications_read on public.notifications
  for select to authenticated
  using (
    public.app_owns(station_id)
    and (target_role is null or target_role = public.app_role())
  );

create policy notification_reads_read on public.notification_reads
  for select to authenticated using (profile_id = auth.uid());
create policy notification_reads_write on public.notification_reads
  for insert to authenticated with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Sensor devices — configuration, therefore manager-only
-- ---------------------------------------------------------------------------
create policy sensor_devices_read on public.sensor_devices
  for select to authenticated using (public.app_owns(station_id));
create policy sensor_devices_write on public.sensor_devices
  for all to authenticated
  using (public.app_owns(station_id) and public.app_is_manager())
  with check (public.app_owns(station_id) and public.app_is_manager());

-- ===========================================================================
-- GRANTS
--
-- Supabase grants ALL on new public tables to anon/authenticated by default.
-- Anything append-only must have those privileges taken back explicitly — RLS
-- alone would still allow an UPDATE that matches no rows to be attempted, and
-- more importantly a future policy mistake would be immediately exploitable.
-- ===========================================================================

revoke all on public.inventory_transactions from anon, authenticated;
grant select on public.inventory_transactions to authenticated;

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;

revoke all on public.tank_balances from anon, authenticated;
grant select on public.tank_balances to authenticated;

revoke all on public.fuel_price_history from anon, authenticated;
grant select on public.fuel_price_history to authenticated;

revoke insert, update, delete on public.tank_readings from anon, authenticated;
grant insert on public.tank_readings to authenticated;

revoke delete on public.deliveries, public.sales, public.adjustments,
                 public.reconciliation_sessions, public.reconciliation_lines,
                 public.tanks
  from anon, authenticated;

revoke insert on public.reconciliation_sessions, public.reconciliation_lines
  from anon, authenticated;

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

revoke all privileges on all tables in schema public from anon;
grant select on public.units to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
--
-- The ledger primitives must never be callable from a browser session: a
-- supervisor could otherwise mint inventory by invoking fn_post_transaction
-- through PostgREST's RPC endpoint.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.fn_post_transaction(uuid, public.txn_type, numeric, date, uuid, text, uuid, text, uuid, bigint),
  public.fn_reverse_transaction(bigint, text, uuid),
  public.fn_post_reconciliation_variance(uuid, uuid),
  public.fn_engine_on(),
  public.fn_raise_notification(uuid, public.notification_kind, public.notification_severity, text, text, text, text, text, public.user_role),
  public.fn_resolve_notification(uuid, text),
  public.fn_ingest_sensor_reading(text, text, numeric, timestamptz, numeric, numeric, numeric, jsonb)
from public, anon, authenticated;

-- The hardware gateway authenticates as service_role behind a server-side
-- route; it is the only caller of the ingestion function.
grant execute on function
  public.fn_ingest_sensor_reading(text, text, numeric, timestamptz, numeric, numeric, numeric, jsonb)
to service_role;

-- Application-facing RPCs.
grant execute on function
  public.fn_open_reconciliation(uuid, date, uuid),
  public.fn_recompute_reconciliation(uuid),
  public.fn_record_closing_measurement(uuid, uuid, numeric, public.reading_source, uuid, text, jsonb),
  public.fn_submit_reconciliation(uuid, text),
  public.fn_review_reconciliation(uuid, boolean, text),
  public.fn_station_snapshot(uuid, date),
  public.fn_variance_trend(uuid, integer),
  public.fn_period_opening(uuid, date, smallint),
  public.fn_period_movements(uuid, date, smallint)
to authenticated;
