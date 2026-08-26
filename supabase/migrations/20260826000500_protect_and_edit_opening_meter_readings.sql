-- Protect opening readings and provide an audited manager-only correction path.
create or replace function public.fn_guard_opening_meter_reading()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role;
  v_previous numeric;
  v_session_station uuid;
  v_session_status public.reconciliation_status;
begin
  select s.station_id, s.status into v_session_station, v_session_status
  from public.reconciliation_sessions s where s.id = new.session_id;
  if v_session_station is null then raise exception 'الجلسة غير موجودة.' using errcode = 'foreign_key_violation'; end if;

  select p.role into v_role from public.profiles p
  where p.id = coalesce(new.recorded_by, auth.uid()) and p.station_id = v_session_station and p.is_active;
  if v_role is null then raise exception 'المستخدم الحالي غير صالح.' using errcode = 'insufficient_privilege'; end if;

  if tg_op = 'UPDATE' and new.opening_reading is distinct from old.opening_reading and v_role <> 'manager' then
    raise exception 'تعديل قراءة البداية متاح للمدير فقط.' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' and v_role <> 'manager' then
    select r.opening_reading into v_previous
    from public.reconciliation_meter_readings r
    join public.reconciliation_sessions s on s.id = r.session_id
    where r.meter_id = new.meter_id and s.station_id = v_session_station
      and s.status <> 'open' and r.closing_reading is not null
    order by s.submitted_at desc nulls last, r.recorded_at desc
    limit 1;
    if v_previous is not null and new.opening_reading <> v_previous then
      raise exception 'قراءة البداية يجب أن تساوي إغلاق الجلسة السابقة.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_opening_meter_readings on public.reconciliation_meter_readings;
create trigger trg_guard_opening_meter_readings
before insert or update of opening_reading on public.reconciliation_meter_readings
for each row execute function public.fn_guard_opening_meter_reading();

create or replace function public.fn_manager_update_opening_meter(
  p_session_id uuid, p_meter_id uuid, p_opening_reading numeric,
  p_reason text, p_actor_id uuid default null
)
returns public.reconciliation_meter_readings
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_role public.user_role;
  v_old public.reconciliation_meter_readings%rowtype;
  v_new public.reconciliation_meter_readings%rowtype;
  v_station_id uuid;
begin
  if auth.uid() is not null and v_actor <> auth.uid() then
    raise exception 'هوية المستخدم غير صالحة.' using errcode = 'insufficient_privilege';
  end if;
  select s.station_id into v_station_id from public.reconciliation_sessions s
  where s.id = p_session_id and s.status = 'open';
  if v_station_id is null then raise exception 'لا يمكن تعديل قراءة جلسة مغلقة أو غير موجودة.' using errcode = 'restrict_violation'; end if;
  select p.role into v_role from public.profiles p
  where p.id = v_actor and p.station_id = v_station_id and p.is_active;
  if v_role <> 'manager' then raise exception 'تعديل قراءة البداية متاح للمدير فقط.' using errcode = 'insufficient_privilege'; end if;
  if p_opening_reading is null or p_opening_reading < 0 then raise exception 'قراءة البداية غير صحيحة.' using errcode = 'check_violation'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'سبب التعديل مطلوب.' using errcode = 'check_violation'; end if;

  select r.* into v_old from public.reconciliation_meter_readings r
  where r.session_id = p_session_id and r.meter_id = p_meter_id for update;
  if not found then raise exception 'قراءة العداد غير موجودة في هذه الجلسة.' using errcode = 'no_data_found'; end if;
  if v_old.closing_reading is not null and p_opening_reading > v_old.closing_reading then
    raise exception 'قراءة البداية لا يمكن أن تتجاوز قراءة الإغلاق الحالية.' using errcode = 'check_violation';
  end if;

  update public.reconciliation_meter_readings
  set opening_reading = p_opening_reading, recorded_by = v_actor, recorded_at = now()
  where id = v_old.id returning * into v_new;
  update public.reconciliation_lines l
  set opening_meter = case when l.meter_id = p_meter_id then p_opening_reading else l.opening_meter end,
      opening_meter2 = case when l.meter2_id = p_meter_id then p_opening_reading else l.opening_meter2 end
  where l.id = v_old.reconciliation_line_id;
  insert into public.audit_logs(station_id, actor_id, actor_role, action, entity, entity_id, entity_label, changed_fields, before_state, after_state, reason)
  values (v_station_id, v_actor, v_role, 'update', 'reconciliation_meter_readings', v_new.id::text,
    'قراءة عداد ' || p_meter_id::text, array['opening_reading'],
    jsonb_build_object('meter_id', p_meter_id, 'session_id', p_session_id, 'opening_reading', v_old.opening_reading),
    jsonb_build_object('meter_id', p_meter_id, 'session_id', p_session_id, 'opening_reading', v_new.opening_reading), p_reason);
  perform public.fn_recompute_reconciliation(p_session_id);
  return v_new;
end;
$$;

grant execute on function public.fn_manager_update_opening_meter(uuid, uuid, numeric, text, uuid) to authenticated;
revoke all on function public.fn_manager_update_opening_meter(uuid, uuid, numeric, text, uuid) from anon;
