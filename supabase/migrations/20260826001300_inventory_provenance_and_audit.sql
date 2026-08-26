-- Inventory audit hardening.
-- Fuel movements have exactly two operational origins: an active delivery
-- (increase) and a completed meter-reading difference (decrease). Approved
-- adjustments remain an explicit, manager-approved exception.

create or replace function public.fn_guard_inventory_source()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source_id is null or coalesce(btrim(new.source_table), '') = '' then
    raise exception 'كل حركة مخزون يجب أن ترتبط بمصدر محدد.' using errcode = 'check_violation';
  end if;

  if new.reverses_txn_id is null and exists (
    select 1
    from public.inventory_transactions prior
    where prior.source_table = new.source_table
      and prior.source_id = new.source_id
      and prior.txn_type = new.txn_type
      and prior.reverses_txn_id is null
  ) then
    raise exception 'تمت معالجة حركة المخزون لهذا المصدر مسبقًا.' using errcode = 'unique_violation';
  end if;

  -- Reversals intentionally retain the original source and type. They are
  -- corrections to immutable history, not a second operational movement.
  if new.reverses_txn_id is not null then
    return new;
  end if;

  case new.txn_type::text
    when 'delivery' then
      if new.source_table <> 'deliveries' or new.quantity_delta <= 0 then
        raise exception 'إضافة المخزون يجب أن تكون من توريد فعلي موجب.' using errcode = 'check_violation';
      end if;
    when 'variance_writeoff' then
      if new.source_table <> 'reconciliation_meter_readings' or new.quantity_delta >= 0 then
        raise exception 'خصم المخزون يجب أن يكون فرق عداد سالبًا مرتبطًا بقراءة عداد.' using errcode = 'check_violation';
      end if;
    when 'adjustment' then
      if new.source_table <> 'adjustments' then
        raise exception 'تسوية المخزون يجب أن ترتبط بطلب تسوية معتمد.' using errcode = 'check_violation';
      end if;
    when 'sale' then
      raise exception 'المبيعات المسجلة لا تخصم المخزون؛ فرق العداد هو المصدر الوحيد للخصم.' using errcode = 'check_violation';
    else
      raise exception 'نوع حركة مخزون غير مسموح به في مسار الوقود الحالي.' using errcode = 'check_violation';
  end case;

  return new;
end;
$$;

drop trigger if exists trg_guard_inventory_source on public.inventory_transactions;
create trigger trg_guard_inventory_source
  before insert on public.inventory_transactions
  for each row execute function public.fn_guard_inventory_source();

comment on function public.fn_guard_inventory_source() is
  'Enforces source provenance and idempotency for every new inventory movement.';

create or replace function public.fn_inventory_audit(p_station_id uuid)
returns table (
  total_sessions_checked bigint,
  completed_sessions bigint,
  incomplete_sessions bigint,
  missing_inventory_movements bigint,
  duplicate_inventory_movements bigint,
  total_meter_deduction numeric,
  total_supply_increase numeric,
  inventory_mismatches bigint,
  customer_transactions_ignored bigint,
  supplier_accounting_transactions_ignored bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.app_owns(p_station_id) or not public.app_is_manager() then
    raise exception 'تقرير تدقيق المخزون متاح للمدير في محطته فقط.' using errcode = 'insufficient_privilege';
  end if;

  return query
  with sessions as (
    select id, status from public.reconciliation_sessions where station_id = p_station_id
  ), missing as (
    select rr.id
    from public.reconciliation_meter_readings rr
    join public.reconciliation_sessions s on s.id = rr.session_id
    join public.reconciliation_lines l on l.id = rr.reconciliation_line_id
    where s.station_id = p_station_id
      and s.status in ('submitted', 'approved')
      and rr.closing_reading is not null
      and coalesce(rr.meter_sold_qty, 0) > 0
      -- A line-level writeoff is retained only for pre-migration history.
      and l.writeoff_txn_id is null
      and not exists (
        select 1 from public.inventory_transactions x
        where x.source_table = 'reconciliation_meter_readings'
          and x.source_id = rr.id
          and x.txn_type = 'variance_writeoff'
      )
  ), duplicates as (
    select greatest(count(*) - 1, 0) as extra_rows
    from public.inventory_transactions
    where station_id = p_station_id and reverses_txn_id is null
    group by source_table, source_id, txn_type
    having count(*) > 1
  )
  select
    (select count(*) from sessions),
    (select count(*) from sessions where status in ('submitted', 'approved')),
    (select count(*) from sessions where status not in ('submitted', 'approved')),
    (select count(*) from missing),
    coalesce((select sum(extra_rows) from duplicates), 0),
    public.fn_vol(coalesce((select -sum(quantity_delta) from public.inventory_transactions where station_id = p_station_id and txn_type = 'variance_writeoff'), 0)),
    public.fn_vol(coalesce((select sum(quantity_delta) from public.inventory_transactions where station_id = p_station_id and txn_type = 'delivery'), 0)),
    (select count(*) from public.tank_balance_check where station_id = p_station_id),
    (select count(*) from public.customer_internal_transactions where station_id = p_station_id)
      + (select count(*) from public.account_transactions where station_id = p_station_id and account_type = 'customer'),
    (select count(*) from public.account_transactions where station_id = p_station_id and account_type = 'supplier');
end;
$$;

revoke all on function public.fn_inventory_audit(uuid) from public, anon;
grant execute on function public.fn_inventory_audit(uuid) to authenticated;

comment on function public.fn_inventory_audit(uuid) is
  'Read-only manager audit of sessions, source movements, ledger totals, cache drift, and ignored accounting records.';
