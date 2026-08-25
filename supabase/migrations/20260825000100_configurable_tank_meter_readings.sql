-- Configurable meter count per tank. Existing tanks keep their current
-- two-meter behavior; new sessions snapshot the value on reconciliation_lines.
alter table public.tanks
  add column if not exists meter_readings_count smallint not null default 1;
alter table public.tanks drop constraint if exists tanks_meter_readings_count_check;
alter table public.tanks add constraint tanks_meter_readings_count_check check (meter_readings_count >= 1);

alter table public.pump_meters drop constraint if exists pump_meters_slot_check;
alter table public.reconciliation_lines
  add column if not exists meter_readings_count smallint not null default 1;
alter table public.reconciliation_lines drop constraint if exists reconciliation_lines_meter_readings_count_check;
alter table public.reconciliation_lines add constraint reconciliation_lines_meter_readings_count_check check (meter_readings_count >= 1);

create table if not exists public.reconciliation_meter_readings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.reconciliation_sessions(id) on delete cascade,
  reconciliation_line_id uuid not null references public.reconciliation_lines(id) on delete cascade,
  meter_id uuid not null references public.pump_meters(id) on delete restrict,
  reading_number smallint not null check (reading_number >= 1),
  opening_reading numeric(16,3) not null check (opening_reading >= 0),
  closing_reading numeric(16,3) check (closing_reading >= 0),
  meter_sold_qty numeric(16,3) generated always as (
    case when closing_reading is null then null else closing_reading - opening_reading end
  ) stored,
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  unique (session_id, meter_id),
  unique (reconciliation_line_id, reading_number)
);
create index if not exists reconciliation_meter_readings_session_idx
  on public.reconciliation_meter_readings(session_id, reconciliation_line_id, reading_number);
alter table public.reconciliation_meter_readings enable row level security;
drop policy if exists reconciliation_meter_readings_station_access on public.reconciliation_meter_readings;
create policy reconciliation_meter_readings_station_access on public.reconciliation_meter_readings
  for all to authenticated using (
    exists (
      select 1 from public.reconciliation_sessions s
      where s.id = session_id and public.app_owns(s.station_id)
    )
  ) with check (
    exists (
      select 1 from public.reconciliation_sessions s
      where s.id = session_id and public.app_owns(s.station_id)
    )
  );

-- Preserve the historical two-meter rows as independent readings.
insert into public.reconciliation_meter_readings
  (session_id, reconciliation_line_id, meter_id, reading_number, opening_reading, closing_reading, recorded_at)
select l.session_id, l.id, l.meter_id, 1, l.opening_meter, l.closing_meter, coalesce(l.computed_at, now())
from public.reconciliation_lines l
where l.meter_id is not null and l.opening_meter is not null
on conflict (session_id, meter_id) do nothing;
update public.reconciliation_lines l
set meter_readings_count = greatest(1, (select count(*) from public.reconciliation_meter_readings r where r.reconciliation_line_id = l.id))
where exists (select 1 from public.reconciliation_meter_readings r where r.reconciliation_line_id = l.id);
update public.tanks t
set meter_readings_count = greatest(1, (select count(*) from public.pump_meters pm where pm.tank_id = t.id and pm.is_active));
insert into public.reconciliation_meter_readings
  (session_id, reconciliation_line_id, meter_id, reading_number, opening_reading, closing_reading, recorded_at)
select l.session_id, l.id, l.meter2_id, 2, l.opening_meter2, l.closing_meter2, coalesce(l.computed_at, now())
from public.reconciliation_lines l
where l.meter2_id is not null and l.opening_meter2 is not null
on conflict (session_id, meter_id) do nothing;

create or replace function public.fn_create_tank_pump_meter()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_active and new.status = 'operational' then
    insert into public.pump_meters (station_id, tank_id, code, name, meter_slot)
    select new.station_id, new.id, 'M' || slot || '-' || new.code,
           'عداد ' || slot || ' ' || new.name, slot
    from generate_series(1, new.meter_readings_count) as slot
    on conflict (station_id, tank_id, meter_slot) do update
      set is_active = true, code = excluded.code, name = excluded.name, updated_at = now();
    update public.pump_meters set is_active = false, updated_at = now()
      where station_id = new.station_id and tank_id = new.id and meter_slot > new.meter_readings_count;
  end if;
  return new;
end;
$$;

-- Snapshot the configured count and create one child row per active meter.
create or replace function public.fn_open_reconciliation(
  p_station_id uuid, p_shift_id uuid, p_opening_meters jsonb,
  p_opening_tanks jsonb, p_operator_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_session_id uuid; v_seq smallint; v_operator uuid := coalesce(p_operator_id, auth.uid());
  v_meter jsonb; v_tank jsonb; v_tank_id uuid; v_meter_id uuid; v_reading numeric;
  v_line_id uuid; v_slot smallint; v_count integer; v_expected integer;
begin
  if not public.app_owns(p_station_id) then raise exception 'لا تملك صلاحية فتح جلسة لهذه المحطة.' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from public.profiles where id = v_operator and station_id = p_station_id and is_active) then raise exception 'المستخدم الحالي غير صالح أو غير نشط.' using errcode = 'insufficient_privilege'; end if;
  select seq into v_seq from public.shifts where id = p_shift_id and station_id = p_station_id and is_active;
  if v_seq is null then raise exception 'اختر وردية صالحة.' using errcode = 'foreign_key_violation'; end if;
  if jsonb_typeof(p_opening_meters) <> 'array' or jsonb_typeof(p_opening_tanks) <> 'array' then raise exception 'قراءات العدادات والخزانات مطلوبة.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.reconciliation_sessions where station_id = p_station_id and status = 'open') then raise exception 'توجد جلسة مفتوحة بالفعل لهذه المحطة.' using errcode = 'unique_violation'; end if;
  select coalesce(sum(t.meter_readings_count), 0) into v_expected from public.tanks t where t.station_id = p_station_id and t.is_active and t.status = 'operational';
  if jsonb_array_length(p_opening_meters) <> v_expected then raise exception 'يجب إدخال جميع قراءات العدادات المطلوبة لكل خزان.' using errcode = 'check_violation'; end if;
  if jsonb_array_length(p_opening_tanks) <> (select count(*) from public.tanks where station_id = p_station_id and is_active and status = 'operational') then raise exception 'يجب تسجيل الرصيد الافتتاحي لكل الخزانات.' using errcode = 'check_violation'; end if;
  if (select count(*) from (select distinct value->>'meter_id' from jsonb_array_elements(p_opening_meters)) x) <> v_expected then raise exception 'لا تسمح بقراءات عداد مكررة.' using errcode = 'check_violation'; end if;

  insert into public.reconciliation_sessions (station_id, business_date, shift_id, shift_seq, opened_by)
  values (p_station_id, current_date, p_shift_id, v_seq, v_operator) returning id into v_session_id;
  insert into public.reconciliation_lines (session_id, station_id, tank_id, fuel_type_id, meter_readings_count)
  select v_session_id, t.station_id, t.id, t.fuel_type_id, t.meter_readings_count
    from public.tanks t where t.station_id = p_station_id and t.is_active and t.status = 'operational';

  for v_meter in select value from jsonb_array_elements(p_opening_meters) loop
    v_meter_id := nullif(v_meter->>'meter_id', '')::uuid;
    v_reading := (v_meter->>'reading')::numeric;
    select pm.tank_id, pm.meter_slot into v_tank_id, v_slot
      from public.pump_meters pm join public.tanks t on t.id = pm.tank_id
     where pm.id = v_meter_id and pm.station_id = p_station_id and pm.is_active and t.is_active and t.status = 'operational';
    if v_tank_id is null or v_reading is null or v_reading < 0 then raise exception 'توجد قراءة عداد غير صحيحة.' using errcode = 'check_violation'; end if;
    select id into v_line_id from public.reconciliation_lines where session_id = v_session_id and tank_id = v_tank_id;
    insert into public.reconciliation_meter_readings (session_id, reconciliation_line_id, meter_id, reading_number, opening_reading, recorded_by)
    values (v_session_id, v_line_id, v_meter_id, v_slot, public.fn_vol(v_reading), v_operator);
    if v_slot = 1 then update public.reconciliation_lines set meter_id = v_meter_id, opening_meter = public.fn_vol(v_reading) where id = v_line_id;
    elsif v_slot = 2 then update public.reconciliation_lines set meter2_id = v_meter_id, opening_meter2 = public.fn_vol(v_reading) where id = v_line_id; end if;
  end loop;
  for v_tank in select value from jsonb_array_elements(p_opening_tanks) loop
    v_tank_id := nullif(v_tank->>'tank_id', '')::uuid; v_reading := (v_tank->>'reading')::numeric;
    if v_reading is null or v_reading < 0 then raise exception 'رصيد افتتاحي غير صحيح.' using errcode = 'check_violation'; end if;
    insert into public.tank_readings (station_id, tank_id, reading_type, source, business_date, shift_id, quantity, recorded_by, notes)
    values (p_station_id, v_tank_id, 'opening', 'manual', current_date, p_shift_id, public.fn_vol(v_reading), v_operator, 'Opening reading for shift');
    update public.reconciliation_lines set opening_tank_qty = public.fn_vol(v_reading) where session_id = v_session_id and tank_id = v_tank_id;
  end loop;
  if exists (select 1 from public.reconciliation_lines l where l.session_id = v_session_id and (l.opening_tank_qty is null or (select count(*) from public.reconciliation_meter_readings r where r.reconciliation_line_id = l.id) <> l.meter_readings_count)) then raise exception 'يجب إدخال جميع قراءات العداد المطلوبة لكل خزان.' using errcode = 'check_violation'; end if;
  perform public.fn_recompute_reconciliation(v_session_id); return v_session_id;
end; $$;

create or replace function public.fn_record_closing_meter(p_session_id uuid, p_meter_id uuid, p_meter_reading numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.reconciliation_sessions%rowtype; r public.reconciliation_meter_readings%rowtype; l public.reconciliation_lines%rowtype;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id for update;
  if not found then raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found'; end if;
  if not public.app_owns(s.station_id) then raise exception 'لا تملك صلاحية هذه الوردية.' using errcode = 'insufficient_privilege'; end if;
  if s.status <> 'open' then raise exception 'لا يمكن تعديل قراءة وردية مغلقة.' using errcode = 'restrict_violation'; end if;
  select * into r from public.reconciliation_meter_readings where session_id = p_session_id and meter_id = p_meter_id for update;
  if not found or p_meter_reading is null or p_meter_reading < r.opening_reading then raise exception 'قراءة النهاية لا يمكن أن تقل عن البداية.' using errcode = 'check_violation'; end if;
  update public.reconciliation_meter_readings set closing_reading = public.fn_vol(p_meter_reading), recorded_at = now() where id = r.id;
  select * into l from public.reconciliation_lines where id = r.reconciliation_line_id;
  if r.reading_number = 1 then update public.reconciliation_lines set closing_meter = public.fn_vol(p_meter_reading) where id = l.id;
  elsif r.reading_number = 2 then update public.reconciliation_lines set closing_meter2 = public.fn_vol(p_meter_reading) where id = l.id; end if;
  update public.reconciliation_lines set meter_sold_qty = (select public.fn_vol(coalesce(sum(meter_sold_qty), 0)) from public.reconciliation_meter_readings where reconciliation_line_id = l.id) where id = l.id;
  perform public.fn_recompute_reconciliation(p_session_id);
end; $$;

create or replace function public.fn_submit_reconciliation(p_session_id uuid, p_notes text default null, p_operator_id uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.reconciliation_sessions%rowtype; settings public.system_settings%rowtype; v_missing text;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id for update;
  if not found then raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found'; end if;
  if not public.app_owns(s.station_id) then raise exception 'لا تملك صلاحية هذه الوردية.' using errcode = 'insufficient_privilege'; end if;
  if s.status <> 'open' then raise exception 'هذه الوردية مغلقة بالفعل.' using errcode = 'restrict_violation'; end if;
  select string_agg(t.name || ' يحتاج قراءة العداد رقم ' || r.reading_number, '، ' order by t.name, r.reading_number) into v_missing
    from public.reconciliation_lines l join public.tanks t on t.id = l.tank_id
    join public.reconciliation_meter_readings r on r.reconciliation_line_id = l.id
   where l.session_id = p_session_id and r.closing_reading is null;
  if v_missing is not null then raise exception 'أكمل قراءات الإغلاق: %.', v_missing using errcode = 'check_violation'; end if;
  if exists (select 1 from public.reconciliation_lines l where l.session_id = p_session_id and (select count(*) from public.reconciliation_meter_readings r where r.reconciliation_line_id = l.id) <> l.meter_readings_count) then raise exception 'لم تكتمل قراءات العدادات المطلوبة.' using errcode = 'check_violation'; end if;
  perform public.fn_recompute_reconciliation(p_session_id);
  select * into settings from public.system_settings where station_id = s.station_id;
  if coalesce(settings.post_variance_on_submit, true) then perform public.fn_post_reconciliation_variance(p_session_id, coalesce(p_operator_id, auth.uid())); end if;
  update public.reconciliation_sessions set status = 'submitted', submitted_by = coalesce(p_operator_id, auth.uid()), submitted_at = now(), notes = coalesce(nullif(btrim(p_notes), ''), notes) where id = p_session_id;
end; $$;

grant select, insert, update on public.reconciliation_meter_readings to authenticated, service_role;
grant execute on function public.fn_record_closing_meter(uuid, uuid, numeric) to authenticated;
grant execute on function public.fn_open_reconciliation(uuid, uuid, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.fn_submit_reconciliation(uuid, text, uuid) to authenticated;