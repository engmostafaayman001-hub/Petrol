-- Opening meter readings may differ from the previous session closing readings.
create or replace function public.fn_open_reconciliation(
  p_station_id uuid, p_shift_id uuid, p_opening_meters jsonb,
  p_opening_tanks jsonb, p_operator_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_session_id uuid; v_seq smallint; v_operator uuid := coalesce(p_operator_id, auth.uid());
  v_meter jsonb; v_tank jsonb; v_tank_id uuid; v_meter_id uuid; v_reading numeric;
  v_line_id uuid; v_slot smallint; v_expected integer; v_price numeric;
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
  insert into public.reconciliation_sessions (station_id, business_date, shift_id, shift_seq, opened_by) values (p_station_id, current_date, p_shift_id, v_seq, v_operator) returning id into v_session_id;
  perform public.fn_engine_on();
  insert into public.reconciliation_lines (session_id, station_id, tank_id, fuel_type_id, meter_readings_count)
  select v_session_id, t.station_id, t.id, t.fuel_type_id, t.meter_readings_count from public.tanks t where t.station_id = p_station_id and t.is_active and t.status = 'operational';
  update public.reconciliation_lines l set opening_tank_qty = public.fn_vol(coalesce(b.quantity, 0)) from public.tank_balances b where l.session_id = v_session_id and b.tank_id = l.tank_id;
  for v_meter in select value from jsonb_array_elements(p_opening_meters) loop
    v_meter_id := nullif(v_meter->>'meter_id', '')::uuid; v_reading := (v_meter->>'reading')::numeric;
    select pm.tank_id, pm.meter_slot into v_tank_id, v_slot from public.pump_meters pm join public.tanks t on t.id = pm.tank_id where pm.id = v_meter_id and pm.station_id = p_station_id and pm.is_active and t.is_active and t.status = 'operational';
    if v_tank_id is null or v_reading is null or v_reading < 0 then raise exception 'توجد قراءة عداد غير صحيحة.' using errcode = 'check_violation'; end if;
    select l.id, coalesce(f.selling_price, 0) into v_line_id, v_price from public.reconciliation_lines l join public.tanks t on t.id = l.tank_id join public.fuel_types f on f.id = t.fuel_type_id where l.session_id = v_session_id and l.tank_id = v_tank_id;
    insert into public.reconciliation_meter_readings (session_id, reconciliation_line_id, meter_id, reading_number, opening_reading, unit_price, recorded_by) values (v_session_id, v_line_id, v_meter_id, v_slot, public.fn_vol(v_reading), v_price, v_operator);
    if v_slot = 1 then update public.reconciliation_lines set meter_id = v_meter_id, opening_meter = public.fn_vol(v_reading) where id = v_line_id;
    elsif v_slot = 2 then update public.reconciliation_lines set meter2_id = v_meter_id, opening_meter2 = public.fn_vol(v_reading) where id = v_line_id; end if;
  end loop;
  for v_tank in select value from jsonb_array_elements(p_opening_tanks) loop
    v_tank_id := nullif(v_tank->>'tank_id', '')::uuid; v_reading := (v_tank->>'reading')::numeric;
    if v_reading is null or v_reading < 0 then raise exception 'رصيد افتتاحي غير صحيح.' using errcode = 'check_violation'; end if;
    insert into public.tank_readings (station_id, tank_id, reading_type, source, business_date, shift_id, quantity, recorded_by, notes) values (p_station_id, v_tank_id, 'opening', 'manual', current_date, p_shift_id, public.fn_vol(v_reading), v_operator, 'Opening reading for shift');
    update public.reconciliation_lines set opening_tank_qty = public.fn_vol(v_reading) where session_id = v_session_id and tank_id = v_tank_id;
  end loop;
  if exists (select 1 from public.reconciliation_lines l where l.session_id = v_session_id and (l.opening_tank_qty is null or (select count(*) from public.reconciliation_meter_readings r where r.reconciliation_line_id = l.id) <> l.meter_readings_count)) then raise exception 'يجب إدخال جميع قراءات العداد المطلوبة لكل خزان.' using errcode = 'check_violation'; end if;
  perform public.fn_recompute_reconciliation(v_session_id); return v_session_id;
end; $$;

grant execute on function public.fn_open_reconciliation(uuid, uuid, jsonb, jsonb, uuid) to authenticated;
