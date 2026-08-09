-- ===========================================================================
-- 0004 · INVENTORY LEDGER
--
-- The ledger is the single source of truth for how much fuel exists. Nothing
-- in the system "sets" stock: every change is an append-only signed movement.
-- Current stock is the sum of those movements, cached in tank_balances.
--
-- The ledger is written exclusively by public.fn_post_transaction(), which
-- holds a row lock on the tank while it validates and appends. Direct INSERT,
-- UPDATE and DELETE are revoked from every application role.
-- ===========================================================================

create table public.inventory_transactions (
  id               bigint generated always as identity primary key,
  station_id       uuid        not null references public.stations (id) on delete restrict,
  tank_id          uuid        not null references public.tanks (id) on delete restrict,
  fuel_type_id     uuid        not null references public.fuel_types (id) on delete restrict,

  txn_type         public.txn_type not null,
  -- Signed. Positive adds product to the tank, negative removes it.
  quantity_delta   numeric(16, 3) not null,

  -- Accounting period. (business_date, shift_seq) is the total ordering used by
  -- every period calculation; occurred_at is wall-clock metadata only. This is
  -- what makes back-dated entry safe and deterministic.
  business_date    date        not null,
  shift_id         uuid        references public.shifts (id) on delete restrict,
  shift_seq        smallint    not null default 0,
  occurred_at      timestamptz not null default now(),

  -- Running balance in *insertion* order. Useful for forensics and for showing
  -- a ledger tape; period maths never reads it, because a back-dated entry
  -- would make it non-monotonic with respect to business_date.
  running_balance  numeric(16, 3) not null,

  -- Provenance. Points back at the operational record that caused the movement.
  source_table     text        not null,
  source_id        uuid,
  reverses_txn_id  bigint      references public.inventory_transactions (id) on delete restrict,

  note             text,
  created_by       uuid        references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),

  constraint inventory_transactions_delta_nonzero check (quantity_delta <> 0),
  constraint inventory_transactions_source_known  check (source_table <> '')
);

-- Period roll-ups: the hot path for every reconciliation and report.
create index inventory_txn_period_idx
  on public.inventory_transactions (tank_id, business_date, shift_seq);

create index inventory_txn_station_period_idx
  on public.inventory_transactions (station_id, business_date desc, shift_seq);

create index inventory_txn_fuel_period_idx
  on public.inventory_transactions (fuel_type_id, business_date desc);

create index inventory_txn_source_idx
  on public.inventory_transactions (source_table, source_id);

-- One reversal per transaction, at most.
create unique index inventory_txn_reversal_uq
  on public.inventory_transactions (reverses_txn_id)
  where reverses_txn_id is not null;

-- Append-only, enforced for every role including service_role.
create trigger trg_inventory_txn_immutable
  before update or delete on public.inventory_transactions
  for each row execute function public.fn_block_write();

comment on table public.inventory_transactions is
  'Append-only inventory ledger. Written only via fn_post_transaction(). Corrections are reversing entries, never edits.';

-- ---------------------------------------------------------------------------
-- fn_post_transaction — the only writer of the ledger
--
-- Validates against tank capacity and negative stock (both configurable per
-- station), appends the movement and refreshes the cached balance atomically.
-- ---------------------------------------------------------------------------
create or replace function public.fn_post_transaction(
  p_tank_id       uuid,
  p_txn_type      public.txn_type,
  p_delta         numeric,
  p_business_date date,
  p_shift_id      uuid,
  p_source_table  text,
  p_source_id     uuid,
  p_note          text default null,
  p_actor         uuid default null,
  p_reverses      bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tank      public.tanks%rowtype;
  v_settings  public.system_settings%rowtype;
  v_shift_seq smallint := 0;
  v_current   numeric(16, 3);
  v_new       numeric(16, 3);
  v_delta     numeric(16, 3) := public.fn_vol(p_delta);
  v_txn_id    bigint;
begin
  if v_delta = 0 then
    raise exception 'A zero-quantity movement cannot be posted.'
      using errcode = 'check_violation';
  end if;

  select * into v_tank from public.tanks where id = p_tank_id;
  if not found then
    raise exception 'The selected tank does not exist.' using errcode = 'foreign_key_violation';
  end if;

  if not v_tank.is_active or v_tank.status <> 'operational' then
    raise exception 'Tank % is not in service and cannot receive movements.', v_tank.code
      using errcode = 'check_violation';
  end if;

  select * into v_settings from public.system_settings where station_id = v_tank.station_id;

  if p_shift_id is not null then
    select seq into v_shift_seq
      from public.shifts
     where id = p_shift_id and station_id = v_tank.station_id;

    if v_shift_seq is null then
      raise exception 'The selected shift does not belong to this station.'
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  -- Serialise concurrent movements on this tank. Two supervisors submitting at
  -- the same instant cannot both read a stale balance.
  select quantity into v_current
    from public.tank_balances
   where tank_id = p_tank_id
     for update;

  if v_current is null then
    insert into public.tank_balances (tank_id, station_id, quantity)
    values (p_tank_id, v_tank.station_id, 0)
    on conflict (tank_id) do nothing;
    v_current := 0;
  end if;

  v_new := public.fn_vol(v_current + v_delta);

  if v_new < 0 and not coalesce(v_settings.allow_negative_balance, false) then
    raise exception
      'This movement would take tank % to % units. Stock cannot go negative — check for a missing delivery.',
      v_tank.code, v_new
      using errcode = 'check_violation';
  end if;

  if v_delta > 0
     and coalesce(v_settings.enforce_tank_capacity, true)
     and v_new > v_tank.capacity then
    raise exception
      'This movement would put % units into tank %, which holds at most % units (currently %).',
      v_delta, v_tank.code, v_tank.capacity, v_current
      using errcode = 'check_violation';
  end if;

  insert into public.inventory_transactions (
    station_id, tank_id, fuel_type_id, txn_type, quantity_delta,
    business_date, shift_id, shift_seq, running_balance,
    source_table, source_id, reverses_txn_id, note, created_by
  ) values (
    v_tank.station_id, p_tank_id, v_tank.fuel_type_id, p_txn_type, v_delta,
    p_business_date, p_shift_id, coalesce(v_shift_seq, 0), v_new,
    p_source_table, p_source_id, p_reverses, p_note, coalesce(p_actor, auth.uid())
  )
  returning id into v_txn_id;

  update public.tank_balances
     set quantity         = v_new,
         last_txn_id      = v_txn_id,
         last_movement_at = now(),
         updated_at       = now()
   where tank_id = p_tank_id;

  return v_txn_id;
end;
$$;

comment on function public.fn_post_transaction is
  'Sole entry point for inventory movements. Validates capacity/negative stock, appends to the ledger and refreshes the cached balance under a row lock.';

-- ---------------------------------------------------------------------------
-- fn_reverse_transaction — corrections without rewriting history
--
-- Used when an operational record is voided. The original row stays exactly as
-- captured; a mirror-image movement neutralises its effect.
-- ---------------------------------------------------------------------------
create or replace function public.fn_reverse_transaction(
  p_txn_id bigint,
  p_reason text,
  p_actor  uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orig public.inventory_transactions%rowtype;
begin
  select * into v_orig from public.inventory_transactions where id = p_txn_id;
  if not found then
    raise exception 'The original movement could not be found.' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.inventory_transactions where reverses_txn_id = p_txn_id) then
    raise exception 'This movement has already been reversed.' using errcode = 'unique_violation';
  end if;

  return public.fn_post_transaction(
    v_orig.tank_id,
    v_orig.txn_type,
    -v_orig.quantity_delta,
    v_orig.business_date,
    v_orig.shift_id,
    v_orig.source_table,
    v_orig.source_id,
    coalesce(p_reason, 'Reversal of movement #' || p_txn_id),
    p_actor,
    p_txn_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Period arithmetic
--
-- Opening balance for a period = the sum of every movement that belongs to an
-- *earlier* period, using row comparison on (business_date, shift_seq). This is
-- insertion-order independent, so back-dated corrections produce the same
-- answer as if they had been entered on time.
-- ---------------------------------------------------------------------------
create or replace function public.fn_period_opening(
  p_tank_id       uuid,
  p_business_date date,
  p_shift_seq     smallint
)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.fn_vol(coalesce(sum(t.quantity_delta), 0))
    from public.inventory_transactions t
   where t.tank_id = p_tank_id
     and (t.business_date, t.shift_seq) < (p_business_date, p_shift_seq);
$$;

-- Movement totals inside a single period, split by category. Returned as one
-- row so a reconciliation line needs exactly one scan of the ledger.
create or replace function public.fn_period_movements(
  p_tank_id       uuid,
  p_business_date date,
  p_shift_seq     smallint
)
returns table (
  delivered  numeric,
  sold       numeric,
  adjusted   numeric,
  written_off numeric,
  transferred numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.fn_vol(coalesce(sum(t.quantity_delta) filter (where t.txn_type = 'delivery'), 0)),
    public.fn_vol(coalesce(-sum(t.quantity_delta) filter (where t.txn_type = 'sale'), 0)),
    public.fn_vol(coalesce(sum(t.quantity_delta) filter (where t.txn_type = 'adjustment'), 0)),
    public.fn_vol(coalesce(sum(t.quantity_delta) filter (where t.txn_type = 'variance_writeoff'), 0)),
    public.fn_vol(coalesce(sum(t.quantity_delta) filter (where t.txn_type in ('transfer_in','transfer_out')), 0))
    from public.inventory_transactions t
   where t.tank_id = p_tank_id
     and t.business_date = p_business_date
     and t.shift_seq = p_shift_seq;
$$;

-- ---------------------------------------------------------------------------
-- Integrity self-check
--
-- Compares the cached balance with a fresh sum of the ledger. Surfaced to
-- managers in Settings › Data integrity. A non-empty result means the cache
-- drifted and must be investigated — it should always be empty.
-- ---------------------------------------------------------------------------
create or replace view public.tank_balance_check as
  select
    b.tank_id,
    b.station_id,
    t.code               as tank_code,
    b.quantity           as cached_quantity,
    public.fn_vol(coalesce(l.ledger_quantity, 0)) as ledger_quantity,
    public.fn_vol(b.quantity - coalesce(l.ledger_quantity, 0)) as drift
  from public.tank_balances b
  join public.tanks t on t.id = b.tank_id
  left join lateral (
    select sum(quantity_delta) as ledger_quantity
      from public.inventory_transactions x
     where x.tank_id = b.tank_id
  ) l on true
  where public.fn_vol(b.quantity - coalesce(l.ledger_quantity, 0)) <> 0;
