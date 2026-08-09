-- ===========================================================================
-- 0001 · FOUNDATION
-- Extensions, domain enums, and generic utility triggers used by every
-- subsequent migration.
-- ===========================================================================

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "citext"   with schema extensions;

-- ---------------------------------------------------------------------------
-- Domain enums
-- ---------------------------------------------------------------------------

-- Exactly two operational roles in v1. Additional roles can be appended
-- without a data migration because authorization is expressed as
-- capability checks (app_is_manager / app_can_write) rather than
-- role string comparisons scattered through policies.
create type public.user_role as enum ('manager', 'supervisor');

create type public.tank_status as enum (
  'operational',    -- in service, participates in inventory
  'maintenance',    -- temporarily out of service, no new movements
  'decommissioned'  -- retired, read-only history
);

-- Every event that can change the physical contents of a tank.
-- 'sensor_correction' is reserved for the future hardware integration and is
-- already accepted by the ledger; nothing emits it in v1.
create type public.txn_type as enum (
  'opening_balance',
  'delivery',
  'sale',
  'adjustment',
  'variance_writeoff',
  'transfer_in',
  'transfer_out',
  'sensor_correction'
);

create type public.record_status as enum ('active', 'voided');

create type public.reading_type as enum ('opening', 'closing', 'spot');

-- Provenance of a measured quantity. The reconciliation engine is agnostic to
-- this value: a sensor reading and a dipstick reading enter through the same
-- table and the same code path. Only the UI distinguishes them.
create type public.reading_source as enum ('manual', 'sensor', 'calculated');

create type public.variance_status as enum ('balanced', 'minor', 'warning', 'critical');

create type public.reconciliation_status as enum ('open', 'submitted', 'approved', 'rejected');

create type public.adjustment_status as enum ('pending', 'approved', 'rejected');

create type public.notification_severity as enum ('info', 'warning', 'critical');

create type public.notification_kind as enum (
  'tank_below_minimum',
  'tank_near_capacity',
  'large_variance',
  'missing_closing_measurement',
  'unreconciled_period',
  'unusual_sales_volume',
  'pending_approval',
  'sensor_offline'
);

create type public.sensor_status as enum ('unconfigured', 'online', 'offline', 'error', 'disabled');

-- ---------------------------------------------------------------------------
-- Utility triggers
-- ---------------------------------------------------------------------------

create or replace function public.fn_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.fn_touch_updated_at is
  'Maintains updated_at on mutable tables.';

-- Hard stop for append-only tables. Fires for every role including
-- service_role, so an application bug or a leaked key still cannot rewrite
-- history. Only a superuser disabling the trigger could, which is auditable
-- at the infrastructure level.
create or replace function public.fn_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Table %.% is append-only; % is not permitted. Record a reversing entry instead.',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.fn_block_write is
  'Attach as BEFORE UPDATE OR DELETE on append-only tables (ledger, audit log).';

-- Rounds to the canonical 3-decimal precision used for all volumes so that
-- floating point noise never accumulates into a phantom variance.
create or replace function public.fn_vol(p numeric)
returns numeric
language sql
immutable
as $$ select round(coalesce(p, 0)::numeric, 3) $$;
