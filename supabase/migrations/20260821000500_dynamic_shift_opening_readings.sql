-- Dynamic opening workflow: every active meter and operational tank is captured atomically.
alter table public.shifts
  add column if not exists shift_period text;

update public.shifts
   set shift_period = case when seq = 1 then 'morning' else 'evening' end
 where shift_period is null;

alter table public.shifts
  drop constraint if exists shifts_period_check;
alter table public.shifts
  add constraint shifts_period_check check (shift_period in ('morning', 'evening'));

alter table public.reconciliation_lines
  add column if not exists opening_tank_qty numeric(16, 3) check (opening_tank_qty >= 0),
  add column if not exists opening_tank_reading_id uuid references public.tank_readings (id) on delete set null;

create index if not exists recon_lines_opening_reading_idx
  on public.reconciliation_lines (opening_tank_reading_id);

create or replace function public.fn_open_reconciliation(
  p_station_id uuid,
  p_shift_id uuid,
  p_opening_meters jsonb,
  p_opening_tanks jsonb,
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
  v_operator uuid := coalesce(p_operator_id, auth.uid());
  v_meter_count integer;
  v_tank_count integer;
  v_meter jsonb;
  v_tank jsonb;
  v_tank_id uuid;
  v_meter_id uuid;
  v_value numeric;
  v_reading uuid;
begin
  if not public.app_owns(p_station_id) then
    raise exception 'لا تملك صلاحية فتح جلسة لهذه المحطة.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.profiles where id = v_operator and station_id = p_station_id and is_active) then
    raise exception 'المستخدم الحالي غير صالح أو غير نشط.' using errcode = 'insufficient_privilege';
  end if;
  select seq into v_seq from public.shifts where id = p_shift_id and station_id = p_station_id and is_active;
  if v_seq is null then
    raise exception 'اختر وردية صباحية أو مسائية صالحة.' using errcode = 'foreign_key_violation';
  end if;
  if p_opening_meters is null or jsonb_typeof(p_opening_meters) <> 'array'
     or p_opening_tanks is null or jsonb_typeof(p_opening_tanks) <> 'array' then
    raise exception 'قراءات العدادات والخزانات مطلوبة.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.reconciliation_sessions where station_id = p_station_id and status = 'open') then
    raise exception 'توجد جلسة مفتوحة بالفعل لهذه المحطة.' using errcode = 'unique_violation';
  end if;

  select count(*) into v_meter_count from public.pump_meters where station_id = p_station_id and is_active;
  select count(*) into v_tank_count from public.tanks where station_id = p_station_id and is_active and status = 'operational';
  if jsonb_array_length(p_opening_meters) <> v_meter_count then
    raise exception 'يجب تسجيل قراءة بداية لكل العدادات المسجلة.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_opening_tanks) <> v_tank_count then
    raise exception 'يجب تسجيل الرصيد الافتتاحي لكل الخزانات التشغيلية.' using errcode = 'check_violation';
  end if;

  insert into public.reconciliation_sessions
    (station_id, business_date, shift_id, shift_seq, opened_by)
  values (p_station_id, current_date, p_shift_id, v_seq, v_operator)
  returning id into v_session_id;

  insert into public.reconciliation_lines (session_id, station_id, tank_id, fuel_type_id)
  select v_session_id, t.station_id, t.id, t.fuel_type_id
    from public.tanks t
   where t.station_id = p_station_id and t.is_active and t.status = 'operational';

  for v_meter in select value from jsonb_array_elements(p_opening_meters) loop
    v_meter_id := (v_meter->>'meter_id')::uuid;
    v_value := (v_meter->>'reading')::numeric;
    if v_value is null or v_value < 0 or not exists (select 1 from public.pump_meters where id = v_meter_id and station_id = p_station_id and is_active) then
      raise exception 'توجد قراءة عداد غير صحيحة.' using errcode = 'check_violation';
    end if;
    update public.reconciliation_lines
       set meter_id = v_meter_id, opening_meter = public.fn_vol(v_value)
     where session_id = v_session_id and meter_id = v_meter_id;
    if not found then
      select tank_id into v_tank_id from public.pump_meters where id = v_meter_id;
      insert into public.reconciliation_lines (session_id, station_id, tank_id, fuel_type_id, meter_id, opening_meter)
      select v_session_id, t.station_id, t.id, t.fuel_type_id, v_meter_id, public.fn_vol(v_value)
        from public.tanks t where t.id = v_tank_id and t.status = 'operational' and t.is_active
      on conflict (session_id, tank_id) do update set meter_id = excluded.meter_id, opening_meter = excluded.opening_meter;
    end if;
  end loop;

  for v_tank in select value from jsonb_array_elements(p_opening_tanks) loop
    v_tank_id := (v_tank->>'tank_id')::uuid;
    v_value := (v_tank->>'reading')::numeric;
    if v_value is null or v_value < 0 or not exists (select 1 from public.tanks where id = v_tank_id and station_id = p_station_id and is_active and status = 'operational') then
      raise exception 'توجد قراءة خزان غير صحيحة.' using errcode = 'check_violation';
    end if;
    insert into public.tank_readings (station_id, tank_id, reading_type, source, business_date, shift_id, quantity, recorded_by, notes)
    values (p_station_id, v_tank_id, 'opening', 'manual', current_date, p_shift_id, public.fn_vol(v_value), v_operator, 'Opening reading for shift')
    returning id into v_reading;
    update public.reconciliation_lines
       set opening_tank_qty = public.fn_vol(v_value), opening_tank_reading_id = v_reading
     where session_id = v_session_id and tank_id = v_tank_id;
  end loop;

  if exists (select 1 from public.reconciliation_lines where session_id = v_session_id and opening_meter is null) then
    raise exception 'لم يتم حفظ جميع قراءات العدادات.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.reconciliation_lines where session_id = v_session_id and opening_tank_qty is null) then
    raise exception 'لم يتم حفظ جميع أرصدة الخزانات.' using errcode = 'check_violation';
  end if;

  perform public.fn_recompute_reconciliation(v_session_id);
  return v_session_id;
end;
$$;

grant execute on function public.fn_open_reconciliation(uuid, uuid, jsonb, jsonb, uuid) to authenticated;
