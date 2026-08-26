-- Do not allow a caller to submit a session under another user's identity.
create or replace function public.fn_submit_reconciliation(
  p_session_id uuid,
  p_notes text default null,
  p_operator_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.reconciliation_sessions%rowtype;
  v_missing text;
  v_operator uuid := coalesce(p_operator_id, auth.uid());
begin
  if auth.uid() is not null and v_operator <> auth.uid() then
    raise exception 'هوية المستخدم غير صالحة.' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.reconciliation_sessions where id = p_session_id for update;
  if not found then raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found'; end if;
  if not public.app_owns(s.station_id) then raise exception 'لا تملك صلاحية هذه الوردية.' using errcode = 'insufficient_privilege'; end if;
  if s.status <> 'open' then raise exception 'هذه الوردية مغلقة بالفعل.' using errcode = 'restrict_violation'; end if;
  select string_agg(t.name || ' يحتاج قراءة العداد رقم ' || r.reading_number, '، ' order by t.name, r.reading_number)
    into v_missing
    from public.reconciliation_lines l
    join public.tanks t on t.id = l.tank_id
    join public.reconciliation_meter_readings r on r.reconciliation_line_id = l.id
   where l.session_id = p_session_id and r.closing_reading is null;
  if v_missing is not null then raise exception 'أكمل قراءات الإغلاق: %.', v_missing using errcode = 'check_violation'; end if;
  if exists (select 1 from public.reconciliation_lines l where l.session_id = p_session_id and (select count(*) from public.reconciliation_meter_readings r where r.reconciliation_line_id = l.id) <> l.meter_readings_count) then raise exception 'لم تكتمل قراءات العدادات المطلوبة.' using errcode = 'check_violation'; end if;
  perform public.fn_recompute_reconciliation(p_session_id);
  perform public.fn_post_reconciliation_variance(p_session_id, v_operator);
  update public.reconciliation_sessions
     set status = 'submitted', submitted_by = v_operator, submitted_at = now(), notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = p_session_id;
end;
$$;

revoke all on function public.fn_submit_reconciliation(uuid, text, uuid) from public;
grant execute on function public.fn_submit_reconciliation(uuid, text, uuid) to authenticated;
