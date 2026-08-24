-- Keep reporting cash totals distinct from gross revenue on already-migrated databases.
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
begin
  if public.app_jwt_role() <> 'service_role' and not public.app_owns(p_station_id) then
    raise exception 'You do not have access to this station.' using errcode = 'insufficient_privilege';
  end if;

  select * into s from public.reconciliation_sessions
   where station_id = p_station_id and status = 'open'
   order by opened_at desc limit 1;

  if not found then
    return jsonb_build_object('session', null, 'sales', '[]'::jsonb, 'deliveries', '[]'::jsonb,
      'by_fuel', '[]'::jsonb, 'total_revenue', 0, 'total_collected', 0, 'total_remaining', 0,
      'total_delivered_cost', 0, 'sold_quantity', 0, 'delivered_quantity', 0,
      'sale_count', 0, 'delivery_count', 0);
  end if;

  select p.full_name into v_operator from public.profiles p where p.id = s.opened_by;

  select coalesce(jsonb_agg(row_to_json(q) order by q.created_at), '[]'::jsonb) into v_sales
    from (
      select x.id, x.business_date, x.created_at, x.quantity, x.unit_price, x.gross_amount, x.paid_amount,
        x.tank_id, x.fuel_type_id, x.pump_label, x.meter_open, x.meter_close, x.created_by,
        p.full_name as created_by_name, f.code as fuel_code, f.name as fuel_name, t.code as tank_code
      from public.sales x
      join public.fuel_types f on f.id = x.fuel_type_id
      join public.tanks t on t.id = x.tank_id
      left join public.profiles p on p.id = x.created_by
      where x.station_id = s.station_id and x.business_date = s.business_date
        and x.shift_id = s.shift_id and x.status = 'active'
    ) q;

  select coalesce(jsonb_agg(row_to_json(q) order by q.created_at), '[]'::jsonb) into v_deliveries
    from (
      select x.id, x.business_date, x.created_at, x.quantity, x.unit_cost,
        round(coalesce(x.unit_cost, 0) * x.quantity, 2) as total_cost,
        x.tank_id, x.fuel_type_id, x.supplier_id, x.created_by,
        p.full_name as created_by_name, f.code as fuel_code, f.name as fuel_name, t.code as tank_code
      from public.deliveries x
      join public.fuel_types f on f.id = x.fuel_type_id
      join public.tanks t on t.id = x.tank_id
      left join public.profiles p on p.id = x.created_by
      where x.station_id = s.station_id and x.business_date = s.business_date
        and x.shift_id = s.shift_id and x.status = 'active'
    ) q;

  select coalesce(jsonb_agg(row_to_json(q) order by q.fuel_name), '[]'::jsonb) into v_by_fuel
    from (
      select f.name as fuel_name, f.code as fuel_code,
        public.fn_vol(coalesce(sum(x.quantity), 0)) as sold_quantity,
        round(coalesce(sum(x.gross_amount), 0), 2) as revenue,
        round(coalesce(sum(x.paid_amount), 0), 2) as collected,
        public.fn_vol(coalesce((select sum(d.quantity) from public.deliveries d
          where d.station_id = s.station_id and d.business_date = s.business_date
            and d.shift_id = s.shift_id and d.status = 'active' and d.fuel_type_id = f.id), 0)) as delivered_quantity,
        round(coalesce((select sum(coalesce(d.unit_cost, 0) * d.quantity) from public.deliveries d
          where d.station_id = s.station_id and d.business_date = s.business_date
            and d.shift_id = s.shift_id and d.status = 'active' and d.fuel_type_id = f.id), 0), 2) as delivered_cost
      from public.fuel_types f
      left join public.sales x on x.fuel_type_id = f.id and x.station_id = s.station_id
        and x.business_date = s.business_date and x.shift_id = s.shift_id and x.status = 'active'
      where f.station_id = s.station_id and f.is_active
      group by f.id, f.name, f.code
      having count(x.id) > 0 or exists (select 1 from public.deliveries d
        where d.station_id = s.station_id and d.business_date = s.business_date
          and d.shift_id = s.shift_id and d.status = 'active' and d.fuel_type_id = f.id)
    ) q;

  return jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'business_date', s.business_date, 'shift_id', s.shift_id,
      'shift_seq', s.shift_seq, 'status', s.status, 'opened_at', s.opened_at,
      'opened_by', s.opened_by, 'opened_by_name', v_operator, 'meter_id', s.meter_id,
      'total_variance', s.total_variance),
    'sales', v_sales, 'deliveries', v_deliveries, 'by_fuel', v_by_fuel,
    'total_revenue', coalesce((select sum((item->>'gross_amount')::numeric) from jsonb_array_elements(v_sales) item), 0),
    'total_collected', coalesce((select sum((item->>'paid_amount')::numeric) from jsonb_array_elements(v_sales) item), 0),
    'total_remaining', coalesce((select sum((item->>'gross_amount')::numeric - (item->>'paid_amount')::numeric) from jsonb_array_elements(v_sales) item), 0),
    'total_delivered_cost', coalesce((select sum((item->>'total_cost')::numeric) from jsonb_array_elements(v_deliveries) item), 0),
    'sold_quantity', coalesce((select sum((item->>'quantity')::numeric) from jsonb_array_elements(v_sales) item), 0),
    'delivered_quantity', coalesce((select sum((item->>'quantity')::numeric) from jsonb_array_elements(v_deliveries) item), 0),
    'sale_count', jsonb_array_length(v_sales), 'delivery_count', jsonb_array_length(v_deliveries));
end;
$$;

-- A tank may have multiple sensor records; expose only the latest active device
-- so stock and capacity are never multiplied by a join.
create or replace view public.v_tank_status
with (security_invoker = true) as
select
  t.id as tank_id, t.station_id, t.code as tank_code, t.name as tank_name, t.status, t.is_active,
  t.capacity, t.max_operating_level, t.min_safe_level, t.dead_stock, t.notes,
  f.id as fuel_type_id, f.code as fuel_code, f.name as fuel_name, f.color_hex as fuel_color, f.selling_price,
  coalesce(b.quantity, 0) as system_quantity, b.last_movement_at,
  greatest(coalesce(b.quantity, 0) - t.dead_stock, 0) as available_quantity,
  case when t.capacity > 0 then round(coalesce(b.quantity, 0) / t.capacity * 100, 2) else 0 end as fill_pct,
  case when t.capacity > 0 then round(t.min_safe_level / t.capacity * 100, 2) else 0 end as min_level_pct,
  coalesce(b.quantity, 0) <= t.min_safe_level as below_minimum,
  greatest(t.max_operating_level - coalesce(b.quantity, 0), 0) as ullage,
  r.quantity as measured_quantity, r.source as measured_source, r.reading_at as measured_at,
  case when r.quantity is null then null else public.fn_vol(r.quantity - coalesce(b.quantity, 0)) end as measured_delta,
  d.id as sensor_device_id, d.status as sensor_status, d.last_reading_at as sensor_last_reading_at
from public.tanks t
join public.fuel_types f on f.id = t.fuel_type_id
left join public.tank_balances b on b.tank_id = t.id
left join lateral (select tr.quantity, tr.source, tr.reading_at from public.tank_readings tr
  where tr.tank_id = t.id order by tr.reading_at desc, tr.created_at desc limit 1) r on true
left join lateral (select sd.id, sd.status, sd.last_reading_at from public.sensor_devices sd
  where sd.tank_id = t.id and sd.is_active order by sd.last_reading_at desc nulls last, sd.created_at desc limit 1) d on true;

grant execute on function public.fn_current_open_session_dashboard(uuid) to authenticated;