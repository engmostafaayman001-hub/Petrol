-- Make the per-tank meter configuration available to all tank read models.
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
  d.id as sensor_device_id, d.status as sensor_status, d.last_reading_at as sensor_last_reading_at,
  t.meter_readings_count
from public.tanks t
join public.fuel_types f on f.id = t.fuel_type_id
left join public.tank_balances b on b.tank_id = t.id
left join lateral (select tr.quantity, tr.source, tr.reading_at from public.tank_readings tr
  where tr.tank_id = t.id order by tr.reading_at desc, tr.created_at desc limit 1) r on true
left join lateral (select sd.id, sd.status, sd.last_reading_at from public.sensor_devices sd
  where sd.tank_id = t.id and sd.is_active order by sd.last_reading_at desc nulls last, sd.created_at desc limit 1) d on true;

notify pgrst, 'reload schema';

drop trigger if exists trg_tanks_create_pump_meter on public.tanks;
create trigger trg_tanks_create_pump_meter
  after insert or update of code, name, status, is_active, meter_readings_count on public.tanks
  for each row execute function public.fn_create_tank_pump_meter();