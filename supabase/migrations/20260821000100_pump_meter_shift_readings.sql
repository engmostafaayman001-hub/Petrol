-- Pump meter based shift readings. Existing sales and reconciliation rows remain intact.
create table if not exists public.pump_meters (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations (id) on delete cascade,
  tank_id uuid not null references public.tanks (id) on delete restrict,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (station_id, code),
  unique (station_id, tank_id)
);

create index if not exists pump_meters_station_idx on public.pump_meters (station_id) where is_active;

insert into public.pump_meters (station_id, tank_id, code, name)
select t.station_id, t.id, 'M-' || t.code, 'عداد ' || t.name
from public.tanks t
where t.is_active
on conflict (station_id, tank_id) do nothing;

alter table public.reconciliation_sessions
  add column if not exists meter_id uuid references public.pump_meters (id) on delete restrict;

alter table public.reconciliation_lines
  add column if not exists meter_id uuid references public.pump_meters (id) on delete restrict,
  add column if not exists opening_meter numeric(16, 3) check (opening_meter >= 0),
  add column if not exists closing_meter numeric(16, 3) check (closing_meter >= 0),
  add column if not exists meter_sold_qty numeric(16, 3) check (meter_sold_qty >= 0);

create index if not exists recon_lines_meter_idx on public.reconciliation_lines (meter_id);

alter table public.pump_meters enable row level security;
create policy pump_meters_read on public.pump_meters
  for select to authenticated using (public.app_owns(station_id));

revoke all on public.pump_meters from anon, authenticated;
grant select on public.pump_meters to authenticated;

drop function if exists public.fn_open_reconciliation(uuid, date, uuid);
drop function if exists public.fn_open_reconciliation(uuid, date, uuid, uuid, numeric);

create or replace function public.fn_open_reconciliation(
  p_station_id uuid,
  p_business_date date,
  p_shift_id uuid,
  p_meter_id uuid default null,
  p_opening_meter numeric default null,
  p_operator_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_id uuid;
  v_seq smallint;
  v_tank_id uuid;
begin
  if not public.app_owns(p_station_id) then
    raise exception 'لا تملك صلاحية الوصول إلى هذه المحطة.' using errcode = 'insufficient_privilege';
  end if;
  if p_business_date > current_date then
    raise exception 'لا يمكن فتح وردية بتاريخ مستقبلي.' using errcode = 'check_violation';
  end if;
  if p_meter_id is null or p_opening_meter is null or p_opening_meter < 0 then
    raise exception 'سجل قراءة بداية العداد قبل فتح الوردية.' using errcode = 'check_violation';
  end if;

  select seq into v_seq from public.shifts
   where id = p_shift_id and station_id = p_station_id and is_active;
  if v_seq is null then
    raise exception 'الوردية المحددة غير متاحة في هذه المحطة.' using errcode = 'foreign_key_violation';
  end if;

  select tank_id into v_tank_id from public.pump_meters
   where id = p_meter_id and station_id = p_station_id and is_active;
  if v_tank_id is null then
    raise exception 'العداد المحدد غير متاح في هذه المحطة.' using errcode = 'foreign_key_violation';
  end if;

  if exists (
    select 1 from public.reconciliation_sessions
    where station_id = p_station_id and opened_by = coalesce(p_operator_id, auth.uid()) and status = 'open'
  ) then
    raise exception 'لديك وردية مفتوحة بالفعل. أغلقها قبل بدء وردية جديدة.' using errcode = 'unique_violation';
  end if;

  select id into v_session_id from public.reconciliation_sessions
   where station_id = p_station_id and business_date = p_business_date and shift_id = p_shift_id;
  if v_session_id is not null then
    if not exists (select 1 from public.reconciliation_lines where session_id = v_session_id and opening_meter is not null) then
      perform public.fn_engine_on();
      update public.reconciliation_sessions set meter_id = p_meter_id where id = v_session_id;
      update public.reconciliation_lines
         set meter_id = p_meter_id, opening_meter = public.fn_vol(p_opening_meter)
       where session_id = v_session_id and tank_id = v_tank_id;
    end if;
    return v_session_id;
  end if;

  insert into public.reconciliation_sessions
    (station_id, business_date, shift_id, shift_seq, opened_by, meter_id)
  values (p_station_id, p_business_date, p_shift_id, v_seq, coalesce(p_operator_id, auth.uid()), p_meter_id)
  returning id into v_session_id;

  insert into public.reconciliation_lines (session_id, station_id, tank_id, fuel_type_id, meter_id, opening_meter)
  select v_session_id, t.station_id, t.id, t.fuel_type_id, p_meter_id, public.fn_vol(p_opening_meter)
    from public.tanks t where t.id = v_tank_id and t.is_active and t.status = 'operational';

  perform public.fn_recompute_reconciliation(v_session_id);
  return v_session_id;
end;
$$;

create or replace function public.fn_recompute_reconciliation(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.reconciliation_sessions%rowtype;
  l record;
  m record;
  v_opening numeric;
  v_expected numeric;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id;
  if not found then raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found'; end if;
  if s.status <> 'open' then return; end if;
  perform public.fn_engine_on();
  for l in select * from public.reconciliation_lines where session_id = p_session_id loop
    v_opening := public.fn_period_opening(l.tank_id, s.business_date, s.shift_seq);
    select * into m from public.fn_period_movements(l.tank_id, s.business_date, s.shift_seq);
    v_expected := public.fn_vol(v_opening + m.delivered - m.sold + m.adjusted);
    update public.reconciliation_lines
       set opening_qty = v_opening, delivered_qty = m.delivered, sold_qty = m.sold,
           adjusted_qty = m.adjusted, expected_closing_qty = v_expected,
           variance_qty = case
             when l.meter_id is not null and l.meter_sold_qty is not null then public.fn_vol(l.meter_sold_qty - m.sold)
             when l.actual_closing_qty is null then null
             else public.fn_vol(l.actual_closing_qty - v_expected) end,
           variance_pct = case
             when l.meter_id is not null and l.meter_sold_qty is not null then public.fn_variance_pct(l.meter_sold_qty - m.sold, m.sold)
             when l.actual_closing_qty is null then null
             else public.fn_variance_pct(l.actual_closing_qty - v_expected, v_expected) end,
           variance_status = case
             when l.meter_id is not null and l.meter_sold_qty is not null then public.fn_classify_variance(l.station_id, l.meter_sold_qty - m.sold, m.sold)
             when l.actual_closing_qty is null then null
             else public.fn_classify_variance(l.station_id, l.actual_closing_qty - v_expected, v_expected) end,
           computed_at = now()
     where id = l.id;
  end loop;
  update public.reconciliation_sessions t
     set total_opening = agg.opening, total_delivered = agg.delivered, total_sold = agg.sold,
         total_adjusted = agg.adjusted, total_expected = agg.expected, total_actual = agg.actual,
         total_variance = agg.variance, worst_status = agg.worst
    from (select public.fn_vol(coalesce(sum(opening_qty),0)) opening,
                 public.fn_vol(coalesce(sum(delivered_qty),0)) delivered,
                 public.fn_vol(coalesce(sum(sold_qty),0)) sold,
                 public.fn_vol(coalesce(sum(adjusted_qty),0)) adjusted,
                 public.fn_vol(coalesce(sum(expected_closing_qty),0)) expected,
                 public.fn_vol(coalesce(sum(coalesce(meter_sold_qty, actual_closing_qty)),0)) actual,
                 public.fn_vol(coalesce(sum(variance_qty),0)) variance,
                 coalesce((select rl.variance_status from public.reconciliation_lines rl where rl.session_id = p_session_id and rl.variance_status is not null order by public.fn_variance_rank(rl.variance_status) desc limit 1),'balanced') worst
            from public.reconciliation_lines where session_id = p_session_id) agg
   where t.id = p_session_id;
end;
$$;

create or replace function public.fn_record_closing_meter(
  p_session_id uuid,
  p_meter_reading numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.reconciliation_sessions%rowtype;
  l public.reconciliation_lines%rowtype;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id for update;
  if not found then raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found'; end if;
  if not public.app_owns(s.station_id) then raise exception 'لا تملك صلاحية هذه الوردية.' using errcode = 'insufficient_privilege'; end if;
  if s.status <> 'open' then raise exception 'لا يمكن تعديل قراءة وردية مغلقة.' using errcode = 'restrict_violation'; end if;
  if p_meter_reading is null or p_meter_reading < 0 then raise exception 'قراءة نهاية العداد غير صحيحة.' using errcode = 'check_violation'; end if;
  select * into l from public.reconciliation_lines where session_id = p_session_id and meter_id = s.meter_id for update;
  if not found then raise exception 'لا يوجد عداد مرتبط بهذه الوردية.' using errcode = 'foreign_key_violation'; end if;
  if p_meter_reading < l.opening_meter then raise exception 'قراءة نهاية العداد لا يمكن أن تقل عن قراءة البداية (%).', l.opening_meter using errcode = 'check_violation'; end if;
  perform public.fn_engine_on();
  update public.reconciliation_lines set closing_meter = public.fn_vol(p_meter_reading), meter_sold_qty = public.fn_vol(p_meter_reading - l.opening_meter) where id = l.id;
  perform public.fn_recompute_reconciliation(p_session_id);
end;
$$;

drop function if exists public.fn_submit_reconciliation(uuid, text);

create or replace function public.fn_submit_reconciliation(p_session_id uuid, p_notes text default null, p_operator_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare s public.reconciliation_sessions%rowtype; settings public.system_settings%rowtype; v_missing text;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id for update;
  if not found then raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found'; end if;
  if not public.app_owns(s.station_id) then raise exception 'لا تملك صلاحية هذه الوردية.' using errcode = 'insufficient_privilege'; end if;
  if s.status <> 'open' then raise exception 'هذه الوردية مغلقة بالفعل.' using errcode = 'restrict_violation'; end if;
  perform public.fn_recompute_reconciliation(p_session_id);
  select string_agg(pm.code, ', ' order by pm.code) into v_missing
    from public.reconciliation_lines rl join public.pump_meters pm on pm.id = rl.meter_id
   where rl.session_id = p_session_id and (rl.opening_meter is null or rl.closing_meter is null);
  if v_missing is not null then raise exception 'سجل قراءة نهاية العداد قبل إغلاق الوردية: %.', v_missing using errcode = 'check_violation'; end if;
  select * into settings from public.system_settings where station_id = s.station_id;
  if coalesce(settings.post_variance_on_submit, true) then perform public.fn_post_reconciliation_variance(p_session_id, coalesce(p_operator_id, auth.uid())); end if;
  perform public.fn_engine_on();
  update public.reconciliation_sessions set status = 'submitted', submitted_by = coalesce(p_operator_id, auth.uid()), submitted_at = now(), notes = coalesce(nullif(btrim(p_notes),''), notes) where id = p_session_id;
end;
$$;

grant execute on function public.fn_record_closing_meter(uuid, numeric) to authenticated;
grant execute on function public.fn_open_reconciliation(uuid, date, uuid, uuid, numeric, uuid) to authenticated;
grant execute on function public.fn_submit_reconciliation(uuid, text, uuid) to authenticated;
