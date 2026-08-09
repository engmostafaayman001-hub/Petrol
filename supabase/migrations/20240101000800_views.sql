-- ===========================================================================
-- 0008 · READ MODELS
--
-- Every view is declared `security_invoker = true` so it evaluates the caller's
-- row-level policies rather than the view owner's. Without this, a view is a
-- silent RLS bypass.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Tank status — the shape the dashboard and tank screens consume.
--
-- Exposes system quantity and measured quantity side by side, plus the source
-- of the measurement. This is the contract that lets a gauge reading replace a
-- dipstick reading without a single UI change.
-- ---------------------------------------------------------------------------
create view public.v_tank_status
with (security_invoker = true) as
select
  t.id                    as tank_id,
  t.station_id,
  t.code                  as tank_code,
  t.name                  as tank_name,
  t.status,
  t.is_active,
  t.capacity,
  t.max_operating_level,
  t.min_safe_level,
  t.dead_stock,
  t.notes,

  f.id                    as fuel_type_id,
  f.code                  as fuel_code,
  f.name                  as fuel_name,
  f.color_hex             as fuel_color,
  f.selling_price,

  coalesce(b.quantity, 0) as system_quantity,
  b.last_movement_at,

  -- Usable stock excludes the unpumpable heel.
  greatest(coalesce(b.quantity, 0) - t.dead_stock, 0) as available_quantity,
  case when t.capacity > 0
       then round(coalesce(b.quantity, 0) / t.capacity * 100, 2) else 0 end as fill_pct,
  case when t.capacity > 0
       then round(t.min_safe_level / t.capacity * 100, 2) else 0 end        as min_level_pct,
  coalesce(b.quantity, 0) <= t.min_safe_level as below_minimum,
  greatest(t.max_operating_level - coalesce(b.quantity, 0), 0) as ullage,

  r.quantity   as measured_quantity,
  r.source     as measured_source,
  r.reading_at as measured_at,
  case when r.quantity is null then null
       else public.fn_vol(r.quantity - coalesce(b.quantity, 0)) end as measured_delta,

  d.id           as sensor_device_id,
  d.status       as sensor_status,
  d.last_reading_at as sensor_last_reading_at
from public.tanks t
join public.fuel_types f on f.id = t.fuel_type_id
left join public.tank_balances b on b.tank_id = t.id
left join lateral (
  select tr.quantity, tr.source, tr.reading_at
    from public.tank_readings tr
   where tr.tank_id = t.id
   order by tr.reading_at desc, tr.created_at desc
   limit 1
) r on true
left join public.sensor_devices d on d.tank_id = t.id and d.is_active;

-- ---------------------------------------------------------------------------
-- Ledger feed — the human-readable inventory tape.
-- ---------------------------------------------------------------------------
create view public.v_ledger_feed
with (security_invoker = true) as
select
  x.id,
  x.station_id,
  x.tank_id,
  t.code            as tank_code,
  x.fuel_type_id,
  f.code            as fuel_code,
  f.name            as fuel_name,
  f.color_hex       as fuel_color,
  x.txn_type,
  x.quantity_delta,
  x.running_balance,
  x.business_date,
  x.shift_id,
  s.code            as shift_code,
  s.name            as shift_name,
  x.occurred_at,
  x.source_table,
  x.source_id,
  x.reverses_txn_id,
  x.note,
  x.created_by,
  p.full_name       as created_by_name,
  x.created_at
from public.inventory_transactions x
join public.tanks t       on t.id = x.tank_id
join public.fuel_types f  on f.id = x.fuel_type_id
left join public.shifts s on s.id = x.shift_id
left join public.profiles p on p.id = x.created_by;

-- ---------------------------------------------------------------------------
-- Deliveries and sales, joined for reporting and list screens.
-- ---------------------------------------------------------------------------
create view public.v_deliveries
with (security_invoker = true) as
select
  d.*,
  t.code  as tank_code,
  t.name  as tank_name,
  f.code  as fuel_code,
  f.name  as fuel_name,
  f.color_hex as fuel_color,
  sup.name as supplier_name,
  sh.code as shift_code,
  sh.name as shift_name,
  p.full_name as created_by_name,
  pv.full_name as voided_by_name,
  round(coalesce(d.unit_cost, 0) * d.quantity, 2) as total_cost
from public.deliveries d
join public.tanks t        on t.id = d.tank_id
join public.fuel_types f   on f.id = d.fuel_type_id
join public.shifts sh      on sh.id = d.shift_id
left join public.suppliers sup on sup.id = d.supplier_id
left join public.profiles p    on p.id = d.created_by
left join public.profiles pv   on pv.id = d.voided_by;

create view public.v_sales
with (security_invoker = true) as
select
  s.*,
  t.code  as tank_code,
  t.name  as tank_name,
  f.code  as fuel_code,
  f.name  as fuel_name,
  f.color_hex as fuel_color,
  sh.code as shift_code,
  sh.name as shift_name,
  p.full_name as created_by_name,
  pv.full_name as voided_by_name
from public.sales s
join public.tanks t      on t.id = s.tank_id
join public.fuel_types f on f.id = s.fuel_type_id
join public.shifts sh    on sh.id = s.shift_id
left join public.profiles p  on p.id = s.created_by
left join public.profiles pv on pv.id = s.voided_by;

create view public.v_adjustments
with (security_invoker = true) as
select
  a.*,
  t.code as tank_code,
  f.code as fuel_code,
  f.name as fuel_name,
  pr.full_name as requested_by_name,
  pd.full_name as decided_by_name
from public.adjustments a
join public.tanks t      on t.id = a.tank_id
join public.fuel_types f on f.id = a.fuel_type_id
left join public.profiles pr on pr.id = a.requested_by
left join public.profiles pd on pd.id = a.decided_by;

-- ---------------------------------------------------------------------------
-- Reconciliation read models
-- ---------------------------------------------------------------------------
create view public.v_reconciliation_sessions
with (security_invoker = true) as
select
  r.*,
  sh.code as shift_code,
  sh.name as shift_name,
  po.full_name as opened_by_name,
  ps.full_name as submitted_by_name,
  pr.full_name as reviewed_by_name,
  (select count(*) from public.reconciliation_lines l where l.session_id = r.id) as line_count,
  (select count(*) from public.reconciliation_lines l
    where l.session_id = r.id and l.actual_closing_qty is null) as pending_measurements
from public.reconciliation_sessions r
join public.shifts sh on sh.id = r.shift_id
left join public.profiles po on po.id = r.opened_by
left join public.profiles ps on ps.id = r.submitted_by
left join public.profiles pr on pr.id = r.reviewed_by;

create view public.v_reconciliation_lines
with (security_invoker = true) as
select
  l.*,
  r.business_date,
  r.shift_id,
  r.status as session_status,
  sh.code  as shift_code,
  t.code   as tank_code,
  t.name   as tank_name,
  t.capacity,
  f.code   as fuel_code,
  f.name   as fuel_name,
  f.color_hex as fuel_color
from public.reconciliation_lines l
join public.reconciliation_sessions r on r.id = l.session_id
join public.shifts sh on sh.id = r.shift_id
join public.tanks t   on t.id = l.tank_id
join public.fuel_types f on f.id = l.fuel_type_id;

-- ---------------------------------------------------------------------------
-- Daily aggregates per fuel grade — the backbone of the reporting module.
-- ---------------------------------------------------------------------------
create view public.v_daily_fuel_movement
with (security_invoker = true) as
select
  x.station_id,
  x.business_date,
  x.fuel_type_id,
  f.code      as fuel_code,
  f.name      as fuel_name,
  f.color_hex as fuel_color,
  public.fn_vol(sum(x.quantity_delta) filter (where x.txn_type = 'delivery'))            as delivered,
  public.fn_vol(-sum(x.quantity_delta) filter (where x.txn_type = 'sale'))               as sold,
  public.fn_vol(sum(x.quantity_delta) filter (where x.txn_type = 'adjustment'))          as adjusted,
  public.fn_vol(sum(x.quantity_delta) filter (where x.txn_type = 'variance_writeoff'))   as variance,
  public.fn_vol(sum(x.quantity_delta))                                                   as net_change,
  count(*)                                                                               as movement_count
from public.inventory_transactions x
join public.fuel_types f on f.id = x.fuel_type_id
group by x.station_id, x.business_date, x.fuel_type_id, f.code, f.name, f.color_hex;

-- ---------------------------------------------------------------------------
-- fn_station_snapshot
--
-- One round trip for the whole dashboard header. Returning jsonb keeps the
-- client free of a dozen parallel queries on first paint.
-- ---------------------------------------------------------------------------
create or replace function public.fn_station_snapshot(
  p_station_id uuid,
  p_date       date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if public.app_jwt_role() <> 'service_role' and not public.app_owns(p_station_id) then
    raise exception 'You do not have access to this station.' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'business_date', p_date,

    'stock', (
      select jsonb_build_object(
        'total_system',    public.fn_vol(coalesce(sum(v.system_quantity), 0)),
        'total_available', public.fn_vol(coalesce(sum(v.available_quantity), 0)),
        'total_capacity',  public.fn_vol(coalesce(sum(v.capacity), 0)),
        'tanks_total',     count(*),
        'tanks_below_min', count(*) filter (where v.below_minimum),
        'tanks_offline',   count(*) filter (where v.status <> 'operational')
      )
      from public.v_tank_status v
      where v.station_id = p_station_id and v.is_active
    ),

    'today', (
      select jsonb_build_object(
        'delivered',       public.fn_vol(coalesce(sum(x.quantity_delta) filter (where x.txn_type = 'delivery'), 0)),
        'sold',            public.fn_vol(coalesce(-sum(x.quantity_delta) filter (where x.txn_type = 'sale'), 0)),
        'adjusted',        public.fn_vol(coalesce(sum(x.quantity_delta) filter (where x.txn_type = 'adjustment'), 0)),
        'variance',        public.fn_vol(coalesce(sum(x.quantity_delta) filter (where x.txn_type = 'variance_writeoff'), 0)),
        'delivery_count',  count(distinct x.source_id) filter (where x.txn_type = 'delivery'),
        'sale_count',      count(distinct x.source_id) filter (where x.txn_type = 'sale')
      )
      from public.inventory_transactions x
      where x.station_id = p_station_id and x.business_date = p_date
    ),

    'reconciliation', (
      select jsonb_build_object(
        'sessions',        count(*),
        'submitted',       count(*) filter (where r.status in ('submitted', 'approved')),
        'open',            count(*) filter (where r.status = 'open'),
        'total_expected',  public.fn_vol(coalesce(sum(r.total_expected) filter (where r.status <> 'open'), 0)),
        'total_actual',    public.fn_vol(coalesce(sum(r.total_actual)   filter (where r.status <> 'open'), 0)),
        'total_variance',  public.fn_vol(coalesce(sum(r.total_variance) filter (where r.status <> 'open'), 0))
      )
      from public.reconciliation_sessions r
      where r.station_id = p_station_id and r.business_date = p_date
    ),

    'by_fuel', (
      select coalesce(jsonb_agg(row_to_json(q) order by q.sort_order, q.fuel_code), '[]'::jsonb)
      from (
        select
          f.id as fuel_type_id, f.code as fuel_code, f.name as fuel_name,
          f.color_hex as fuel_color, f.sort_order, f.selling_price,
          public.fn_vol(coalesce(sum(v.system_quantity), 0))    as system_quantity,
          public.fn_vol(coalesce(sum(v.available_quantity), 0)) as available_quantity,
          public.fn_vol(coalesce(sum(v.capacity), 0))           as capacity,
          count(v.tank_id)                                      as tank_count,
          coalesce((select d.delivered from public.v_daily_fuel_movement d
                     where d.fuel_type_id = f.id and d.business_date = p_date), 0) as delivered_today,
          coalesce((select d.sold from public.v_daily_fuel_movement d
                     where d.fuel_type_id = f.id and d.business_date = p_date), 0) as sold_today
        from public.fuel_types f
        left join public.v_tank_status v on v.fuel_type_id = f.id and v.is_active
        where f.station_id = p_station_id and f.is_active
        group by f.id, f.code, f.name, f.color_hex, f.sort_order, f.selling_price
      ) q
    ),

    'attention', (
      select jsonb_build_object(
        'pending_adjustments', (
          select count(*) from public.adjustments a
           where a.station_id = p_station_id and a.status = 'pending'),
        'awaiting_review', (
          select count(*) from public.reconciliation_sessions r
           where r.station_id = p_station_id and r.status = 'submitted'),
        'open_alerts', (
          select count(*) from public.notifications n
           where n.station_id = p_station_id and n.resolved_at is null),
        'critical_alerts', (
          select count(*) from public.notifications n
           where n.station_id = p_station_id and n.resolved_at is null and n.severity = 'critical'),
        'unreconciled_periods', (
          select count(*) from public.shifts sh
           where sh.station_id = p_station_id and sh.is_active
             and not exists (
               select 1 from public.reconciliation_sessions r
                where r.station_id = p_station_id
                  and r.business_date = p_date
                  and r.shift_id = sh.id
                  and r.status in ('submitted', 'approved')))
      )
    ),

    'worst_variance', (
      select coalesce(row_to_json(w)::jsonb, 'null'::jsonb)
      from (
        select l.tank_code, l.fuel_name, l.variance_qty, l.variance_pct,
               l.variance_status, l.business_date
          from public.v_reconciliation_lines l
         where l.station_id = p_station_id
           and l.variance_qty is not null
           and l.business_date >= p_date - 7
         order by abs(l.variance_qty) desc
         limit 1
      ) w
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.fn_station_snapshot is
  'Single-round-trip dashboard payload: stock, today''s movements, reconciliation state, per-grade breakdown and the attention queue.';

-- ---------------------------------------------------------------------------
-- fn_variance_trend — sparkline data for the control deck.
-- ---------------------------------------------------------------------------
create or replace function public.fn_variance_trend(
  p_station_id uuid,
  p_days       integer default 14
)
returns table (
  business_date date,
  delivered     numeric,
  sold          numeric,
  variance      numeric,
  closing_stock numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with days as (
    select generate_series(current_date - (p_days - 1), current_date, interval '1 day')::date as d
  )
  select
    days.d,
    public.fn_vol(coalesce((select sum(x.quantity_delta) from public.inventory_transactions x
       where x.station_id = p_station_id and x.business_date = days.d and x.txn_type = 'delivery'), 0)),
    public.fn_vol(coalesce((select -sum(x.quantity_delta) from public.inventory_transactions x
       where x.station_id = p_station_id and x.business_date = days.d and x.txn_type = 'sale'), 0)),
    public.fn_vol(coalesce((select sum(x.quantity_delta) from public.inventory_transactions x
       where x.station_id = p_station_id and x.business_date = days.d and x.txn_type = 'variance_writeoff'), 0)),
    public.fn_vol(coalesce((select sum(x.quantity_delta) from public.inventory_transactions x
       where x.station_id = p_station_id and x.business_date <= days.d), 0))
  from days
  where public.app_owns(p_station_id)
  order by days.d;
$$;
