-- A partially recorded set of meters is not a final sales total.
create or replace function public.fn_session_sales_summary(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
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
  if not exists (select 1 from public.reconciliation_sessions where id = p_session_id) then
    raise exception 'جلسة التسوية غير موجودة.' using errcode = 'no_data_found';
  end if;
  select coalesce(sum(s.quantity), 0), coalesce(sum(s.quantity) filter (where s.sales_channel = 'regular'), 0), coalesce(sum(s.quantity) filter (where s.sales_channel = 'manual'), 0), coalesce(sum(s.gross_amount), 0), coalesce(sum(s.gross_amount) filter (where s.sales_channel = 'regular'), 0), coalesce(sum(s.gross_amount) filter (where s.sales_channel = 'manual'), 0)
    into v_registered_qty, v_regular_qty, v_manual_qty, v_registered_amount, v_regular_amount, v_manual_amount
    from public.sales s where s.session_id = p_session_id and s.status = 'active';
  select count(*) > 0 and count(*) filter (where r.closing_reading is not null) = count(*), coalesce(sum(r.meter_sold_qty) filter (where r.closing_reading is not null), 0), coalesce(sum(r.meter_value) filter (where r.closing_reading is not null), 0)
    into v_meter_complete, v_meter_qty, v_meter_amount
    from public.reconciliation_meter_readings r where r.session_id = p_session_id;
  select coalesce(jsonb_agg(row_to_json(q) order by q.fuel_name), '[]'::jsonb) into v_by_fuel
    from (
      select f.id as fuel_type_id, f.code as fuel_code, f.name as fuel_name,
        public.fn_vol(coalesce(sum(s.quantity), 0)) as registered_quantity,
        public.fn_vol(coalesce(sum(s.quantity) filter (where s.sales_channel = 'regular'), 0)) as regular_quantity,
        public.fn_vol(coalesce(sum(s.quantity) filter (where s.sales_channel = 'manual'), 0)) as manual_quantity,
        round(coalesce(sum(s.gross_amount), 0), 2) as registered_amount,
        round(coalesce(sum(s.gross_amount) filter (where s.sales_channel = 'regular'), 0), 2) as regular_amount,
        round(coalesce(sum(s.gross_amount) filter (where s.sales_channel = 'manual'), 0), 2) as manual_amount,
        public.fn_vol(coalesce((select sum(r.meter_sold_qty) from public.reconciliation_meter_readings r where r.session_id = p_session_id and r.reconciliation_line_id in (select l.id from public.reconciliation_lines l where l.session_id = p_session_id and l.fuel_type_id = f.id) and r.closing_reading is not null), 0)) as meter_quantity,
        round(coalesce((select sum(r.meter_value) from public.reconciliation_meter_readings r where r.session_id = p_session_id and r.reconciliation_line_id in (select l.id from public.reconciliation_lines l where l.session_id = p_session_id and l.fuel_type_id = f.id) and r.closing_reading is not null), 0), 2) as meter_amount
      from public.fuel_types f
      left join public.sales s on s.session_id = p_session_id and s.fuel_type_id = f.id and s.status = 'active'
      where f.id in (select l.fuel_type_id from public.reconciliation_lines l where l.session_id = p_session_id) or exists (select 1 from public.sales sx where sx.session_id = p_session_id and sx.fuel_type_id = f.id and sx.status = 'active')
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
    'settlementDifferenceQuantity', public.fn_vol(v_meter_qty - v_registered_qty),
    'meterComplete', v_meter_complete,
    'byFuel', v_by_fuel
  );
end;
$$;