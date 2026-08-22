-- Add a current read model after meter columns were added. The legacy view is
-- kept because fn_station_snapshot depends on it.
create view public.v_reconciliation_lines_current
with (security_invoker = true) as
select
  l.id,
  l.session_id,
  l.station_id,
  l.tank_id,
  l.fuel_type_id,
  l.opening_qty,
  l.delivered_qty,
  l.sold_qty,
  l.adjusted_qty,
  l.expected_closing_qty,
  l.actual_closing_qty,
  l.closing_reading_id,
  l.reading_source,
  l.variance_qty,
  l.variance_pct,
  l.variance_status,
  l.writeoff_txn_id,
  l.notes,
  l.computed_at,
  l.meter_id,
  l.opening_meter,
  l.closing_meter,
  l.meter_sold_qty,
  l.opening_tank_qty,
  l.opening_tank_reading_id,
  r.business_date,
  r.shift_id,
  r.status as session_status,
  sh.code as shift_code,
  sh.name as shift_name,
  sh.shift_period,
  t.code as tank_code,
  t.name as tank_name,
  t.capacity,
  f.code as fuel_code,
  f.name as fuel_name,
  f.color_hex as fuel_color
from public.reconciliation_lines l
join public.reconciliation_sessions r on r.id = l.session_id
join public.shifts sh on sh.id = r.shift_id
join public.tanks t on t.id = l.tank_id
join public.fuel_types f on f.id = l.fuel_type_id;

-- Repair legacy lines where the meter exists but was not linked to the line.
select public.fn_engine_on();
update public.reconciliation_lines l
   set meter_id = pm.id
  from public.pump_meters pm
 where l.meter_id is null
   and pm.station_id = l.station_id
   and pm.tank_id = l.tank_id
   and pm.is_active;

notify pgrst, 'reload schema';

grant select on public.v_reconciliation_lines_current to authenticated, service_role;
