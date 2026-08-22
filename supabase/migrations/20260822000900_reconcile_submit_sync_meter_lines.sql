-- Synchronize legacy meter lines before closing a reconciliation session.
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
  settings public.system_settings%rowtype;
  v_missing text;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id for update;
  if not found then raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found'; end if;
  if not public.app_owns(s.station_id) then raise exception 'لا تملك صلاحية هذه الوردية.' using errcode = 'insufficient_privilege'; end if;
  if s.status <> 'open' then raise exception 'هذه الوردية مغلقة بالفعل.' using errcode = 'restrict_violation'; end if;

  perform public.fn_engine_on();
  update public.reconciliation_lines l
     set meter_id = pm.id
    from public.pump_meters pm
   where l.session_id = p_session_id
     and l.meter_id is null
     and pm.station_id = l.station_id
     and pm.tank_id = l.tank_id
     and pm.is_active;
  update public.reconciliation_lines
     set meter_sold_qty = public.fn_vol(closing_meter - opening_meter)
   where session_id = p_session_id
     and opening_meter is not null
     and closing_meter is not null
     and meter_sold_qty is null;

  perform public.fn_recompute_reconciliation(p_session_id);
  select string_agg(coalesce(pm.code, 'عداد غير مربوط'), ', ' order by rl.id)
    into v_missing
    from public.reconciliation_lines rl
    left join public.pump_meters pm on pm.id = rl.meter_id
   where rl.session_id = p_session_id
     and (rl.meter_id is null or rl.opening_meter is null or rl.closing_meter is null or rl.meter_sold_qty is null);
  if v_missing is not null then raise exception 'سجل قراءة البداية والنهاية لكل العدادات قبل إغلاق الوردية: %.', v_missing using errcode = 'check_violation'; end if;

  select * into settings from public.system_settings where station_id = s.station_id;
  if coalesce(settings.post_variance_on_submit, true) then perform public.fn_post_reconciliation_variance(p_session_id, coalesce(p_operator_id, auth.uid())); end if;
  perform public.fn_engine_on();
  update public.reconciliation_sessions
     set status = 'submitted', submitted_by = coalesce(p_operator_id, auth.uid()), submitted_at = now(), notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = p_session_id;
end;
$$;

grant execute on function public.fn_submit_reconciliation(uuid, text, uuid) to authenticated;
