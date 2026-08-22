-- A shift period can be opened and closed more than once during a business day.
-- Only one reconciliation session may remain open for a station at a time.
alter table public.reconciliation_sessions
  drop constraint if exists reconciliation_sessions_station_id_business_date_shift_id_key;

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
  v_meter jsonb;
  v_meter_id uuid;
  v_value numeric;
  v_tank_id uuid;
  v_missing text;
begin
  if not public.app_owns(p_station_id) then raise exception 'لا تملك صلاحية فتح جلسة لهذه المحطة.' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from public.profiles where id = v_operator and station_id = p_station_id and is_active) then raise exception 'المستخدم الحالي غير صالح أو غير نشط.' using errcode = 'insufficient_privilege'; end if;
  select seq into v_seq from public.shifts where id = p_shift_id and station_id = p_station_id and is_active;
  if v_seq is null then raise exception 'اختر وردية صباحية أو مسائية صالحة.' using errcode = 'foreign_key_violation'; end if;
  if p_opening_meters is null or jsonb_typeof(p_opening_meters) <> 'array' then raise exception 'قراءات العدادات مطلوبة.' using errcode = 'check_violation'; end if;
  if coalesce(jsonb_array_length(p_opening_tanks), 0) <> 0 then raise exception 'يتم احتساب أرصدة الخزانات تلقائيًا.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.reconciliation_sessions where station_id = p_station_id and status = 'open') then raise exception 'توجد جلسة مفتوحة بالفعل لهذه المحطة. أغلقها قبل فتح وردية أخرى.' using errcode = 'unique_violation'; end if;

  select string_agg(pm.code, ', ' order by pm.code) into v_missing
    from public.pump_meters pm join public.tanks t on t.id = pm.tank_id
   where pm.station_id = p_station_id and pm.is_active and t.is_active and t.status = 'operational'
     and not exists (select 1 from jsonb_array_elements(p_opening_meters) item where item->>'meter_id' = pm.id::text);
  if v_missing is not null then raise exception 'قراءات العدادات التشغيلية الناقصة: %.', v_missing using errcode = 'check_violation'; end if;
  if jsonb_array_length(p_opening_meters) <> (select count(*) from public.pump_meters pm join public.tanks t on t.id = pm.tank_id where pm.station_id = p_station_id and pm.is_active and t.is_active and t.status = 'operational') then raise exception 'عدد قراءات العدادات لا يطابق عدد العدادات التشغيلية.' using errcode = 'check_violation'; end if;

  insert into public.reconciliation_sessions (station_id, business_date, shift_id, shift_seq, opened_by)
  values (p_station_id, current_date, p_shift_id, v_seq, v_operator)
  returning id into v_session_id;

  perform public.fn_engine_on();
  insert into public.reconciliation_lines (session_id, station_id, tank_id, fuel_type_id)
  select v_session_id, t.station_id, t.id, t.fuel_type_id from public.tanks t where t.station_id = p_station_id and t.is_active and t.status = 'operational';
  update public.reconciliation_lines l set opening_tank_qty = public.fn_vol(coalesce(b.quantity, 0)) from public.tank_balances b where l.session_id = v_session_id and b.tank_id = l.tank_id;

  for v_meter in select value from jsonb_array_elements(p_opening_meters) loop
    v_meter_id := (v_meter->>'meter_id')::uuid;
    v_value := (v_meter->>'reading')::numeric;
    if v_value is null or v_value < 0 then raise exception 'توجد قراءة عداد غير صحيحة.' using errcode = 'check_violation'; end if;
    select pm.tank_id into v_tank_id from public.pump_meters pm join public.tanks t on t.id = pm.tank_id where pm.id = v_meter_id and pm.station_id = p_station_id and pm.is_active and t.is_active and t.status = 'operational';
    if v_tank_id is null then raise exception 'العداد % غير تشغيلي أو غير مرتبط بهذه المحطة.', v_meter_id using errcode = 'check_violation'; end if;
    update public.reconciliation_lines set meter_id = v_meter_id, opening_meter = public.fn_vol(v_value) where session_id = v_session_id and tank_id = v_tank_id;
    if not found then raise exception 'تعذر ربط قراءة العداد % بالخزان التشغيلي.', v_meter_id using errcode = 'check_violation'; end if;
  end loop;
  if exists (select 1 from public.reconciliation_lines where session_id = v_session_id and opening_meter is null) then raise exception 'لم يتم حفظ جميع قراءات العدادات التشغيلية.' using errcode = 'check_violation'; end if;
  perform public.fn_recompute_reconciliation(v_session_id);
  return v_session_id;
end;
$$;

alter function public.fn_open_reconciliation(uuid, uuid, jsonb, jsonb, uuid)
  set timezone to 'Africa/Cairo';

grant execute on function public.fn_open_reconciliation(uuid, uuid, jsonb, jsonb, uuid) to authenticated;
