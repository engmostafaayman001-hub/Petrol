-- Two independent meters per operational tank. Each reconciliation line keeps
-- both opening/closing readings and exposes their combined sold quantity.
alter table public.pump_meters add column if not exists meter_slot smallint not null default 1;
alter table public.pump_meters drop constraint if exists pump_meters_station_id_tank_id_key;
alter table public.pump_meters add constraint pump_meters_slot_check check (meter_slot in (1, 2));
create unique index if not exists pump_meters_station_tank_slot_uq on public.pump_meters (station_id, tank_id, meter_slot);

alter table public.reconciliation_lines
  add column if not exists meter2_id uuid references public.pump_meters(id) on delete restrict,
  add column if not exists opening_meter2 numeric(16,3) check (opening_meter2 >= 0),
  add column if not exists closing_meter2 numeric(16,3) check (closing_meter2 >= 0);

update public.pump_meters set meter_slot = 1 where meter_slot is null;
insert into public.pump_meters (station_id, tank_id, code, name, meter_slot)
select t.station_id, t.id, 'M2-' || t.code, 'عداد 2 ' || t.name, 2
from public.tanks t
where t.is_active and t.status = 'operational'
on conflict (station_id, tank_id, meter_slot) do update set is_active = true, updated_at = now();

create or replace function public.fn_create_tank_pump_meter()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_active and new.status = 'operational' then
    insert into public.pump_meters (station_id, tank_id, code, name, meter_slot)
    values (new.station_id, new.id, 'M-' || new.code, 'عداد 1 ' || new.name, 1),
           (new.station_id, new.id, 'M2-' || new.code, 'عداد 2 ' || new.name, 2)
    on conflict (station_id, tank_id, meter_slot) do update set is_active = true, updated_at = now();
  end if;
  return new;
end;
$$;

create or replace function public.fn_open_reconciliation(p_station_id uuid, p_shift_id uuid, p_opening_meters jsonb, p_opening_tanks jsonb, p_operator_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_session_id uuid; v_seq smallint; v_meter jsonb; v_tank jsonb; v_meter_id uuid; v_tank_id uuid; v_slot smallint; v_value numeric; v_operator uuid := coalesce(p_operator_id, auth.uid()); v_meter_count integer; v_tank_count integer; v_reading uuid;
begin
  if not public.app_owns(p_station_id) then raise exception 'لا تملك صلاحية فتح جلسة لهذه المحطة.' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from public.profiles where id = v_operator and station_id = p_station_id and is_active) then raise exception 'المستخدم الحالي غير صالح أو غير نشط.' using errcode = 'insufficient_privilege'; end if;
  select seq into v_seq from public.shifts where id = p_shift_id and station_id = p_station_id and is_active;
  if v_seq is null then raise exception 'اختر وردية صباحية أو مسائية صالحة.' using errcode = 'foreign_key_violation'; end if;
  if p_opening_meters is null or jsonb_typeof(p_opening_meters) <> 'array' or p_opening_tanks is null or jsonb_typeof(p_opening_tanks) <> 'array' then raise exception 'قراءات العدادات والخزانات مطلوبة.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.reconciliation_sessions where station_id = p_station_id and status = 'open') then raise exception 'توجد جلسة مفتوحة بالفعل لهذه المحطة.' using errcode = 'unique_violation'; end if;
  select count(*) into v_meter_count from public.pump_meters pm join public.tanks t on t.id = pm.tank_id where pm.station_id = p_station_id and pm.is_active and t.is_active and t.status = 'operational';
  select count(*) into v_tank_count from public.tanks where station_id = p_station_id and is_active and status = 'operational';
  if jsonb_array_length(p_opening_meters) <> v_meter_count then raise exception 'يجب تسجيل قراءتين لكل خزان تشغيلي.' using errcode = 'check_violation'; end if;
  if jsonb_array_length(p_opening_tanks) <> v_tank_count then raise exception 'يجب تسجيل الرصيد الافتتاحي لكل الخزانات التشغيلية.' using errcode = 'check_violation'; end if;
  insert into public.reconciliation_sessions (station_id, business_date, shift_id, shift_seq, opened_by) values (p_station_id, current_date, p_shift_id, v_seq, v_operator) returning id into v_session_id;
  insert into public.reconciliation_lines (session_id, station_id, tank_id, fuel_type_id) select v_session_id, t.station_id, t.id, t.fuel_type_id from public.tanks t where t.station_id = p_station_id and t.is_active and t.status = 'operational';
  for v_meter in select value from jsonb_array_elements(p_opening_meters) loop
    v_meter_id := (v_meter->>'meter_id')::uuid; v_value := (v_meter->>'reading')::numeric;
    select pm.tank_id, pm.meter_slot into v_tank_id, v_slot from public.pump_meters pm join public.tanks t on t.id = pm.tank_id where pm.id = v_meter_id and pm.station_id = p_station_id and pm.is_active and t.is_active and t.status = 'operational';
    if v_tank_id is null or v_value is null or v_value < 0 then raise exception 'توجد قراءة عداد غير صحيحة.' using errcode = 'check_violation'; end if;
    if v_slot = 1 then update public.reconciliation_lines set meter_id = v_meter_id, opening_meter = public.fn_vol(v_value) where session_id = v_session_id and tank_id = v_tank_id;
    else update public.reconciliation_lines set meter2_id = v_meter_id, opening_meter2 = public.fn_vol(v_value) where session_id = v_session_id and tank_id = v_tank_id; end if;
  end loop;
  for v_tank in select value from jsonb_array_elements(p_opening_tanks) loop
    v_tank_id := (v_tank->>'tank_id')::uuid; v_value := (v_tank->>'reading')::numeric;
    insert into public.tank_readings (station_id, tank_id, reading_type, source, business_date, shift_id, quantity, recorded_by, notes) values (p_station_id, v_tank_id, 'opening', 'manual', current_date, p_shift_id, public.fn_vol(v_value), v_operator, 'Opening reading for shift') returning id into v_reading;
    update public.reconciliation_lines set opening_tank_qty = public.fn_vol(v_value), opening_tank_reading_id = v_reading where session_id = v_session_id and tank_id = v_tank_id;
  end loop;
  if exists (select 1 from public.reconciliation_lines where session_id = v_session_id and (meter_id is null or meter2_id is null or opening_meter is null or opening_meter2 is null or opening_tank_qty is null)) then raise exception 'لم يتم حفظ قراءتي العداد ورصيد كل خزان.' using errcode = 'check_violation'; end if;
  perform public.fn_recompute_reconciliation(v_session_id); return v_session_id;
end; $$;

create or replace function public.fn_record_closing_meter(p_session_id uuid, p_meter_id uuid, p_meter_reading numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.reconciliation_sessions%rowtype; l public.reconciliation_lines%rowtype; pm public.pump_meters%rowtype; v_line_found boolean;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id for update; if not found then raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found'; end if;
  if not public.app_owns(s.station_id) then raise exception 'لا تملك صلاحية هذه الوردية.' using errcode = 'insufficient_privilege'; end if; if s.status <> 'open' then raise exception 'لا يمكن تعديل قراءة وردية مغلقة.' using errcode = 'restrict_violation'; end if;
  select * into l from public.reconciliation_lines where session_id = p_session_id and (meter_id = p_meter_id or meter2_id = p_meter_id) for update; v_line_found := found;
  select * into pm from public.pump_meters where id = p_meter_id;
  if not v_line_found or not found or p_meter_reading is null or p_meter_reading < 0 then raise exception 'العداد غير مرتبط بهذه الجلسة أو القراءة غير صحيحة.' using errcode = 'check_violation'; end if;
  if pm.meter_slot = 1 then if p_meter_reading < l.opening_meter then raise exception 'قراءة النهاية لا يمكن أن تقل عن البداية.' using errcode = 'check_violation'; end if; update public.reconciliation_lines set closing_meter = public.fn_vol(p_meter_reading), meter_sold_qty = public.fn_vol(p_meter_reading - opening_meter) + public.fn_vol(coalesce(closing_meter2, opening_meter2) - opening_meter2) where id = l.id;
  else if p_meter_reading < l.opening_meter2 then raise exception 'قراءة النهاية لا يمكن أن تقل عن البداية.' using errcode = 'check_violation'; end if; update public.reconciliation_lines set closing_meter2 = public.fn_vol(p_meter_reading), meter_sold_qty = public.fn_vol(coalesce(closing_meter, opening_meter) - opening_meter) + public.fn_vol(p_meter_reading - opening_meter2) where id = l.id; end if;
  perform public.fn_recompute_reconciliation(p_session_id);
end; $$;

grant execute on function public.fn_open_reconciliation(uuid, uuid, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.fn_record_closing_meter(uuid, uuid, numeric) to authenticated;