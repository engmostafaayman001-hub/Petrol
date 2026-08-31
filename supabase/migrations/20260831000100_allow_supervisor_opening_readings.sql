-- Supervisors may enter independent opening meter readings when opening a shift.
-- Existing readings remain protected: changing an opening reading after insert is
-- still a manager-only audited operation through fn_manager_update_opening_meter.
create or replace function public.fn_guard_opening_meter_reading()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp as $$
declare
  v_role public.user_role;
  v_session_station uuid;
begin
  if auth.uid() is not null and new.recorded_by is distinct from auth.uid() then
    raise exception 'هوية المستخدم غير صالحة.' using errcode = 'insufficient_privilege';
  end if;

  select s.station_id into v_session_station
  from public.reconciliation_sessions s
  where s.id = new.session_id;

  if v_session_station is null then
    raise exception 'الجلسة غير موجودة.' using errcode = 'foreign_key_violation';
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = coalesce(new.recorded_by, auth.uid())
    and p.station_id = v_session_station
    and p.is_active;

  if v_role is null then
    raise exception 'المستخدم الحالي غير صالح.' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE'
     and new.opening_reading is distinct from old.opening_reading
     and v_role <> 'manager' then
    raise exception 'تعديل قراءة البداية متاح للمدير فقط.' using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Keep the protected trigger attached even if an earlier deployment changed it.
drop trigger if exists trg_guard_opening_meter_readings on public.reconciliation_meter_readings;
create trigger trg_guard_opening_meter_readings
before insert or update of opening_reading on public.reconciliation_meter_readings
for each row execute function public.fn_guard_opening_meter_reading();
