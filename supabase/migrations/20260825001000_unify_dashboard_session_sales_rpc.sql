-- Keep the dashboard RPC aligned with fn_session_sales_summary.
create or replace function public.fn_current_open_session_dashboard(p_station_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s public.reconciliation_sessions%rowtype;
  v_operator text;
  v_sales jsonb;
  v_deliveries jsonb;
  v_by_fuel jsonb;
  v_summary jsonb;
begin
  if public.app_jwt_role() <> 'service_role' and not public.app_owns(p_station_id) then
    raise exception 'You do not have access to this station.' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.reconciliation_sessions where station_id = p_station_id and status = 'open' order by opened_at desc limit 1;
  if not found then
    return jsonb_build_object('session', null, 'sales', '[]'::jsonb, 'deliveries', '[]'::jsonb, 'by_fuel', '[]'::jsonb, 'total_revenue', 0, 'total_collected', 0, 'total_remaining', 0, 'total_delivered_cost', 0, 'sold_quantity', 0, 'delivered_quantity', 0, 'sale_count', 0, 'delivery_count', 0);
  end if;
  select p.full_name into v_operator from public.profiles p where p.id = s.opened_by;
  select public.fn_session_sales_summary(s.id) into v_summary;
  select coalesce(jsonb_agg(row_to_json(q) order by q.created_at), '[]'::jsonb) into v_sales
    from (
      select x.id, x.business_date, x.created_at, x.quantity, x.unit_price, x.gross_amount, x.paid_amount, x.sales_channel, x.tank_id, x.fuel_type_id, x.pump_label, x.meter_open, x.meter_close, x.created_by, p.full_name as created_by_name, f.code as fuel_code, f.name as fuel_name, t.code as tank_code
      from public.sales x join public.fuel_types f on f.id = x.fuel_type_id join public.tanks t on t.id = x.tank_id left join public.profiles p on p.id = x.created_by
      where x.session_id = s.id and x.status = 'active'
    ) q;
  select coalesce(jsonb_agg(row_to_json(q) order by q.created_at), '[]'::jsonb) into v_deliveries
    from (
      select x.id, x.business_date, x.created_at, x.quantity, x.unit_cost, round(coalesce(x.unit_cost, 0) * x.quantity, 2) as total_cost, x.tank_id, x.fuel_type_id, x.supplier_id, x.created_by, p.full_name as created_by_name, f.code as fuel_code, f.name as fuel_name, t.code as tank_code
      from public.deliveries x join public.fuel_types f on f.id = x.fuel_type_id join public.tanks t on t.id = x.tank_id left join public.profiles p on p.id = x.created_by
      where x.session_id = s.id and x.status = 'active'
    ) q;
  v_by_fuel := coalesce(v_summary->'byFuel', '[]'::jsonb);
  return jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'business_date', s.business_date, 'shift_id', s.shift_id, 'shift_seq', s.shift_seq, 'status', s.status, 'opened_at', s.opened_at, 'opened_by', s.opened_by, 'opened_by_name', v_operator, 'meter_id', s.meter_id, 'total_variance', s.total_variance),
    'sales', v_sales,
    'deliveries', v_deliveries,
    'by_fuel', v_by_fuel,
    'total_revenue', coalesce((v_summary->>'totalSalesAmount')::numeric, 0),
    'total_collected', coalesce((select sum((item->>'paid_amount')::numeric) from jsonb_array_elements(v_sales) item), 0),
    'total_remaining', coalesce((select sum((item->>'gross_amount')::numeric - (item->>'paid_amount')::numeric) from jsonb_array_elements(v_sales) item), 0),
    'total_delivered_cost', coalesce((select sum((item->>'total_cost')::numeric) from jsonb_array_elements(v_deliveries) item), 0),
    'sold_quantity', coalesce((v_summary->>'totalSalesQuantity')::numeric, 0),
    'registered_sales_quantity', coalesce((v_summary->>'registeredSalesQuantity')::numeric, 0),
    'regular_sales_quantity', coalesce((v_summary->>'regularSalesQuantity')::numeric, 0),
    'manual_sales_quantity', coalesce((v_summary->>'manualSalesQuantity')::numeric, 0),
    'settlement_difference_quantity', (v_summary->>'settlementDifferenceQuantity')::numeric,
    'meter_complete', coalesce((v_summary->>'meterComplete')::boolean, false),
    'delivered_quantity', coalesce((select sum((item->>'quantity')::numeric) from jsonb_array_elements(v_deliveries) item), 0),
    'sale_count', jsonb_array_length(v_sales),
    'delivery_count', jsonb_array_length(v_deliveries)
  );
end;
$$;
