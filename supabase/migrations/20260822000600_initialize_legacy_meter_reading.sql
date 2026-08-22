-- One-time compatibility path for open legacy sessions created without meter readings.
create or replace function public.fn_initialize_legacy_meter_reading(
  p_session_id uuid,
  p_line_id uuid,
  p_opening_meter numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.reconciliation_sessions%rowtype;
  v_line public.reconciliation_lines%rowtype;
  v_meter_id uuid;
begin
  select * into v_session from public.reconciliation_sessions where id = p_session_id for update;
  if not found then raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found'; end if;
  if v_session.status <> 'open' then raise exception 'لا يمكن تعديل جلسة مغلقة.' using errcode = 'restrict_violation'; end if;
  if p_opening_meter is null or p_opening_meter < 0 then raise exception 'قراءة الافتتاح غير صحيحة.' using errcode = 'check_violation'; end if;
  select * into v_line from public.reconciliation_lines where id = p_line_id and session_id = p_session_id for update;
  if not found then raise exception 'سطر التسوية غير موجود.' using errcode = 'no_data_found'; end if;
  if v_line.opening_meter is not null then return v_line.meter_id; end if;
  select pm.id into v_meter_id from public.pump_meters pm where pm.station_id = v_session.station_id and pm.tank_id = v_line.tank_id and pm.is_active limit 1;
  if v_meter_id is null then raise exception 'لا يوجد عداد نشط مرتبط بهذا الخزان.' using errcode = 'foreign_key_violation'; end if;
  perform public.fn_engine_on();
  update public.reconciliation_lines set meter_id = v_meter_id, opening_meter = public.fn_vol(p_opening_meter) where id = p_line_id and session_id = p_session_id;
  return v_meter_id;
end;
$$;

grant execute on function public.fn_initialize_legacy_meter_reading(uuid, uuid, numeric) to authenticated;
