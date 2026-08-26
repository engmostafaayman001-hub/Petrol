-- Backfill closed sessions from meter readings, without using the current stock
-- balance as a proxy. Each meter reading owns at most one deduction.
create unique index if not exists inventory_meter_difference_source_uq
  on public.inventory_transactions (source_table, source_id, txn_type)
  where source_table = 'reconciliation_meter_readings'
    and txn_type = 'variance_writeoff'
    and source_id is not null;

create table if not exists public.reconciliation_inventory_deductions (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.reconciliation_sessions(id) on delete cascade,
  meter_id uuid not null references public.pump_meters(id) on delete restrict,
  tank_id uuid not null references public.tanks(id) on delete restrict,
  quantity numeric(16,3) not null check (quantity > 0),
  movement_type text not null default 'meter_difference',
  status text not null check (status in ('pending', 'applied')),
  inventory_txn_id bigint references public.inventory_transactions(id) on delete restrict,
  reason text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (session_id, meter_id, movement_type)
);
create index if not exists reconciliation_inventory_deductions_status_idx
  on public.reconciliation_inventory_deductions(status, created_at);

create or replace function public.fn_post_reconciliation_variance(
  p_session_id uuid,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.reconciliation_sessions%rowtype;
  v_reading public.reconciliation_meter_readings%rowtype;
  l public.reconciliation_lines%rowtype;
  v_txn bigint;
  v_difference numeric;
  v_balance numeric;
  v_allow_negative boolean;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id for update;
  if not found then raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found'; end if;
  if s.status not in ('open', 'submitted', 'approved') then raise exception 'الجلسة غير مكتملة ولا يمكن خصم فرق العداد.' using errcode = 'restrict_violation'; end if;

  perform public.fn_engine_on();
  for v_reading in
    select *
    from public.reconciliation_meter_readings rr
    where rr.session_id = p_session_id and rr.closing_reading is not null
    order by rr.recorded_at, rr.reading_number
    for update
  loop
    select * into l from public.reconciliation_lines where id = v_reading.reconciliation_line_id for update;
    -- Older sessions may already have one line-level writeoff. It represents
    -- the complete tank difference, so never add meter-level entries to it.
    if l.writeoff_txn_id is not null then continue; end if;
    if exists (select 1 from public.inventory_transactions x where x.source_table = 'reconciliation_meter_readings' and x.source_id = v_reading.id and x.txn_type = 'variance_writeoff') then continue; end if;
    v_difference := public.fn_vol(v_reading.meter_sold_qty);
    if v_difference <= 0 then continue; end if;
    select quantity into v_balance from public.tank_balances where tank_id = l.tank_id for update;
    select coalesce(allow_negative_balance, false) into v_allow_negative from public.system_settings where station_id = s.station_id;
    if s.status <> 'open' and not v_allow_negative and coalesce(v_balance, 0) < v_difference then
      insert into public.reconciliation_inventory_deductions(session_id, meter_id, tank_id, quantity, status, reason)
      values (s.id, v_reading.meter_id, l.tank_id, v_difference, 'pending', 'الرصيد الحالي لا يكفي لتطبيق الخصم التاريخي دون إنشاء رصيد سالب')
      on conflict (session_id, meter_id, movement_type) do update set quantity = excluded.quantity, reason = excluded.reason;
      continue;
    end if;
    v_txn := public.fn_post_transaction(
      l.tank_id, 'variance_writeoff', -v_difference, s.business_date, s.shift_id,
      'reconciliation_meter_readings', v_reading.id,
      'خصم فرق العداد من الجلسة المغلقة', p_actor
    );
    insert into public.reconciliation_inventory_deductions(session_id, meter_id, tank_id, quantity, status, inventory_txn_id, applied_at)
    values (s.id, v_reading.meter_id, l.tank_id, v_difference, 'applied', v_txn, now())
    on conflict (session_id, meter_id, movement_type) do update set quantity = excluded.quantity, status = 'applied', inventory_txn_id = excluded.inventory_txn_id, applied_at = excluded.applied_at, reason = null;
  end loop;
end;
$$;

revoke execute on function public.fn_post_reconciliation_variance(uuid, uuid) from anon, authenticated;

create or replace function public.fn_backfill_meter_inventory(
  p_station_id uuid default null,
  p_actor uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s record;
  sale record;
  v_count integer := 0;
  v_has_all_readings boolean;
begin
  for s in
    select rs.id, rs.station_id
    from public.reconciliation_sessions rs
    where rs.status in ('submitted', 'approved')
      and (p_station_id is null or rs.station_id = p_station_id)
    order by rs.submitted_at nulls last, rs.business_date, rs.id
    for update
  loop
    select count(*) > 0 and count(*) filter (where rr.closing_reading is not null) = count(*)
      and count(*) = (select coalesce(sum(l.meter_readings_count), 0) from public.reconciliation_lines l where l.session_id = s.id)
      into v_has_all_readings
      from public.reconciliation_meter_readings rr where rr.session_id = s.id;
    if not v_has_all_readings then continue; end if;

    -- Remove legacy sale-originated fuel deductions for this session. The
    -- immutable ledger keeps reversal rows for a complete audit trail.
    for sale in
      select x.ledger_txn_id
      from public.sales x
      where x.session_id = s.id and x.status = 'active' and x.ledger_txn_id is not null
        and not exists (select 1 from public.inventory_transactions z where z.reverses_txn_id = x.ledger_txn_id)
    loop
      perform public.fn_reverse_transaction(sale.ledger_txn_id, 'تحويل مصدر المخزون إلى فرق العدادات', p_actor);
    end loop;

    perform public.fn_post_reconciliation_variance(s.id, p_actor);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.fn_backfill_meter_inventory(uuid, uuid) from public;

-- Apply the safe backfill once during migration. Re-running the function is
-- idempotent because of the source check and unique index above.
do $$
begin
  alter table public.inventory_transactions disable trigger trg_refresh_open_reconciliation_from_ledger;
  perform public.fn_backfill_meter_inventory(null, null);
  alter table public.inventory_transactions enable trigger trg_refresh_open_reconciliation_from_ledger;
end;
$$;

comment on function public.fn_backfill_meter_inventory(uuid, uuid) is
  'Backfills complete closed sessions from meter differences in chronological order; safe to run repeatedly.';
