-- Harden the single source of truth for session sales.
-- Meter totals become final only when every configured meter has a closing reading.
create or replace function public.fn_session_sales_summary(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_station_id uuid;
  v_expected_meters integer := 0;
  v_actual_meters integer := 0;
  v_closed_meters integer := 0;
  v_registered_qty numeric := 0;
  v_regular_qty numeric := 0;
  v_manual_qty numeric := 0;
  v_registered_amount numeric := 0;
  v_regular_amount numeric := 0;
  v_manual_amount numeric := 0;
  v_meter_qty numeric := 0;
  v_meter_amount numeric := 0;
  v_meter_complete boolean := false;
  v_by_fuel jsonb;
begin
  select station_id into v_station_id
    from public.reconciliation_sessions where id = p_session_id;
  if v_station_id is null then
    raise exception 'جلسة التسوية غير موجودة.' using errcode = 'no_data_found';
  end if;
  if public.app_jwt_role() <> 'service_role' and not public.app_owns(v_station_id) then
    raise exception 'لا تملك صلاحية هذه الجلسة.' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(l.meter_readings_count), 0)
    into v_expected_meters
    from public.reconciliation_lines l where l.session_id = p_session_id;
  select count(*), count(*) filter (where r.closing_reading is not null),
         coalesce(sum(r.meter_sold_qty) filter (where r.closing_reading is not null), 0),
         coalesce(sum(r.meter_value) filter (where r.closing_reading is not null), 0)
    into v_actual_meters, v_closed_meters, v_meter_qty, v_meter_amount
    from public.reconciliation_meter_readings r where r.session_id = p_session_id;
  v_meter_complete := v_expected_meters > 0
    and v_actual_meters = v_expected_meters
    and v_closed_meters = v_expected_meters;

  select coalesce(sum(s.quantity), 0),
         coalesce(sum(s.quantity) filter (where s.sales_channel = 'regular'), 0),
         coalesce(sum(s.quantity) filter (where s.sales_channel = 'manual'), 0),
         coalesce(sum(s.gross_amount), 0),
         coalesce(sum(s.gross_amount) filter (where s.sales_channel = 'regular'), 0),
         coalesce(sum(s.gross_amount) filter (where s.sales_channel = 'manual'), 0)
    into v_registered_qty, v_regular_qty, v_manual_qty,
         v_registered_amount, v_regular_amount, v_manual_amount
    from public.sales s where s.session_id = p_session_id and s.status = 'active';

  select coalesce(jsonb_agg(row_to_json(q) order by q.fuel_name), '[]'::jsonb)
    into v_by_fuel
    from (
      select f.id as fuel_type_id, f.code as fuel_code, f.name as fuel_name,
        public.fn_vol(coalesce(sum(s.quantity), 0)) as registered_quantity,
        public.fn_vol(coalesce(sum(s.quantity) filter (where s.sales_channel = 'regular'), 0)) as regular_quantity,
        public.fn_vol(coalesce(sum(s.quantity) filter (where s.sales_channel = 'manual'), 0)) as manual_quantity,
        round(coalesce(sum(s.gross_amount), 0), 2) as registered_amount,
        round(coalesce(sum(s.gross_amount) filter (where s.sales_channel = 'regular'), 0), 2) as regular_amount,
        round(coalesce(sum(s.gross_amount) filter (where s.sales_channel = 'manual'), 0), 2) as manual_amount,
        public.fn_vol(coalesce((select sum(r.meter_sold_qty) from public.reconciliation_meter_readings r join public.reconciliation_lines l on l.id = r.reconciliation_line_id where r.session_id = p_session_id and l.fuel_type_id = f.id and r.closing_reading is not null), 0)) as meter_quantity,
        round(coalesce((select sum(r.meter_value) from public.reconciliation_meter_readings r join public.reconciliation_lines l on l.id = r.reconciliation_line_id where r.session_id = p_session_id and l.fuel_type_id = f.id and r.closing_reading is not null), 0), 2) as meter_amount
      from public.fuel_types f
      left join public.sales s on s.session_id = p_session_id and s.fuel_type_id = f.id and s.status = 'active'
      where f.id in (select l.fuel_type_id from public.reconciliation_lines l where l.session_id = p_session_id)
         or exists (select 1 from public.sales sx where sx.session_id = p_session_id and sx.fuel_type_id = f.id and sx.status = 'active')
      group by f.id, f.code, f.name
    ) q;

  return jsonb_build_object(
    'meterQuantity', public.fn_vol(v_meter_qty),
    'regularSalesQuantity', public.fn_vol(v_regular_qty),
    'manualSalesQuantity', public.fn_vol(v_manual_qty),
    'registeredSalesQuantity', public.fn_vol(v_registered_qty),
    'totalSalesQuantity', public.fn_vol(case when v_meter_complete then v_meter_qty else v_registered_qty end),
    'registeredSalesAmount', round(v_registered_amount, 2),
    'regularSalesAmount', round(v_regular_amount, 2),
    'manualSalesAmount', round(v_manual_amount, 2),
    'totalSalesAmount', round(case when v_meter_complete then v_meter_amount else v_registered_amount end, 2),
    'settlementDifferenceQuantity', case when v_meter_complete then public.fn_vol(v_meter_qty - v_registered_qty) else null end,
    'meterComplete', v_meter_complete,
    'expectedMeterCount', v_expected_meters,
    'actualMeterCount', v_actual_meters,
    'closedMeterCount', v_closed_meters,
    'byFuel', v_by_fuel
  );
end;
$$;

-- Closing records the reconciliation result; it must not post a second fuel deduction.
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
begin
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
  update public.reconciliation_sessions
     set status = 'submitted', submitted_by = coalesce(p_operator_id, auth.uid()), submitted_at = now(), notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = p_session_id;
end;
$$;
