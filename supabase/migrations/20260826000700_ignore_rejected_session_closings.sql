-- Rejected sessions are not valid sources for the next opening reading.
create or replace function public.fn_guard_opening_meter_reading()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role public.user_role; v_previous numeric; v_session_station uuid;
begin
  if auth.uid() is not null and new.recorded_by is distinct from auth.uid() then raise exception 'هوية المستخدم غير صالحة.' using errcode = 'insufficient_privilege'; end if;
  select s.station_id into v_session_station from public.reconciliation_sessions s where s.id = new.session_id;
  if v_session_station is null then raise exception 'الجلسة غير موجودة.' using errcode = 'foreign_key_violation'; end if;
  select p.role into v_role from public.profiles p where p.id = coalesce(new.recorded_by, auth.uid()) and p.station_id = v_session_station and p.is_active;
  if v_role is null then raise exception 'المستخدم الحالي غير صالح.' using errcode = 'insufficient_privilege'; end if;
  if tg_op = 'UPDATE' and new.opening_reading is distinct from old.opening_reading and v_role <> 'manager' then raise exception 'تعديل قراءة البداية متاح للمدير فقط.' using errcode = 'insufficient_privilege'; end if;
  if tg_op = 'INSERT' and v_role <> 'manager' then
    select r.opening_reading into v_previous from public.reconciliation_meter_readings r join public.reconciliation_sessions s on s.id = r.session_id
    where r.meter_id = new.meter_id and s.station_id = v_session_station and s.status in ('submitted', 'approved') and r.closing_reading is not null
    order by s.submitted_at desc nulls last, r.recorded_at desc limit 1;
    if v_previous is not null and new.opening_reading <> v_previous then raise exception 'قراءة البداية يجب أن تساوي إغلاق الجلسة السابقة.' using errcode = 'check_violation'; end if;
  end if;
  return new;
end;
$$;