-- Final inventory rule:
-- fuel inventory is changed by deliveries and one meter-difference writeoff at
-- session submission. Customer records, payments, services, expenses, and
-- registered sales do not create fuel inventory movements.

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
  if new.unit_price is null then
    select selling_price into new.unit_price
    from public.fuel_types where id = new.fuel_type_id;
  end if;

  -- Sales are operational records only. Meter difference is the inventory
  -- source and is posted once when the session is submitted.
  new.ledger_txn_id := null;
  return new;
end;
$$;

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
  l record;
  v_txn bigint;
  v_difference numeric;
begin
  select * into s
  from public.reconciliation_sessions
  where id = p_session_id
  for update;
  if not found then
    raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found';
  end if;
  if s.status <> 'open' then
    raise exception 'لا يمكن خصم فرق العداد من جلسة مغلقة أو غير مفتوحة.' using errcode = 'restrict_violation';
  end if;

  perform public.fn_engine_on();
  for l in
    select rl.id, rl.tank_id, rl.meter_sold_qty, rl.writeoff_txn_id
    from public.reconciliation_lines rl
    where rl.session_id = p_session_id
      and rl.meter_sold_qty is not null
      and rl.writeoff_txn_id is null
    for update
  loop
    v_difference := public.fn_vol(l.meter_sold_qty);
    if v_difference <= 0 then
      continue;
    end if;
    v_txn := public.fn_post_transaction(
      l.tank_id,
      'variance_writeoff',
      -v_difference,
      s.business_date,
      s.shift_id,
      'reconciliation_lines',
      l.id,
      'خصم فرق العداد المعتمد عند إغلاق الجلسة',
      p_actor
    );
    update public.reconciliation_lines
    set writeoff_txn_id = v_txn
    where id = l.id;
  end loop;
end;
$$;

revoke execute on function public.fn_post_reconciliation_variance(uuid, uuid) from anon, authenticated;

-- Every submit path must apply the meter difference exactly once. The function
-- itself is idempotent through reconciliation_lines.writeoff_txn_id.
comment on function public.fn_post_reconciliation_variance(uuid, uuid) is
  'Sole fuel deduction path for new sessions: one inventory writeoff per meter difference.';

create or replace function public.fn_submit_reconciliation(
  p_session_id uuid,
  p_notes text default null,
  p_operator_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.reconciliation_sessions%rowtype;
  v_missing text;
  v_operator uuid := coalesce(p_operator_id, auth.uid());
begin
  if auth.uid() is not null and v_operator <> auth.uid() then raise exception 'هوية المستخدم غير صالحة.' using errcode = 'insufficient_privilege'; end if;
  select * into s from public.reconciliation_sessions where id = p_session_id for update;
  if not found then raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found'; end if;
  if not public.app_owns(s.station_id) then raise exception 'لا تملك صلاحية هذه الوردية.' using errcode = 'insufficient_privilege'; end if;
  if s.status <> 'open' then raise exception 'هذه الوردية مغلقة بالفعل.' using errcode = 'restrict_violation'; end if;
  select string_agg(t.name || ' يحتاج قراءة العداد رقم ' || r.reading_number, '، ' order by t.name, r.reading_number)
    into v_missing
    from public.reconciliation_lines l
    join public.tanks t on t.id = l.tank_id
    join public.reconciliation_meter_readings r on r.reconciliation_line_id = l.id
   where l.session_id = p_session_id and r.closing_reading is null;
  if v_missing is not null then raise exception 'أكمل قراءات الإغلاق: %.', v_missing using errcode = 'check_violation'; end if;
  if exists (select 1 from public.reconciliation_lines l where l.session_id = p_session_id and (select count(*) from public.reconciliation_meter_readings r where r.reconciliation_line_id = l.id) <> l.meter_readings_count) then raise exception 'لم تكتمل قراءات العدادات المطلوبة.' using errcode = 'check_violation'; end if;
  perform public.fn_recompute_reconciliation(p_session_id);
  perform public.fn_post_reconciliation_variance(p_session_id, v_operator);
  update public.reconciliation_sessions
     set status = 'submitted', submitted_by = v_operator, submitted_at = now(), notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = p_session_id;
end;
$$;

revoke all on function public.fn_submit_reconciliation(uuid, text, uuid) from public;
grant execute on function public.fn_submit_reconciliation(uuid, text, uuid) to authenticated;
