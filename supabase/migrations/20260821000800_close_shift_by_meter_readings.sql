-- Close each meter line by its final counter reading; tank quantities are never entered here.
create or replace function public.fn_record_closing_meter(
  p_session_id uuid,
  p_meter_id uuid,
  p_meter_reading numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.reconciliation_sessions%rowtype;
  l public.reconciliation_lines%rowtype;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id for update;
  if not found then raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found'; end if;
  if not public.app_owns(s.station_id) then raise exception 'لا تملك صلاحية هذه الوردية.' using errcode = 'insufficient_privilege'; end if;
  if s.status <> 'open' then raise exception 'لا يمكن تعديل قراءة وردية مغلقة.' using errcode = 'restrict_violation'; end if;
  if p_meter_reading is null or p_meter_reading < 0 then raise exception 'قراءة نهاية العداد غير صحيحة.' using errcode = 'check_violation'; end if;
  select * into l from public.reconciliation_lines where session_id = p_session_id and meter_id = p_meter_id for update;
  if not found then raise exception 'العداد غير مرتبط بهذه الجلسة.' using errcode = 'foreign_key_violation'; end if;
  if p_meter_reading < l.opening_meter then raise exception 'قراءة نهاية العداد لا يمكن أن تقل عن قراءة البداية (%).', l.opening_meter using errcode = 'check_violation'; end if;
  perform public.fn_engine_on();
  update public.reconciliation_lines
     set closing_meter = public.fn_vol(p_meter_reading), meter_sold_qty = public.fn_vol(p_meter_reading - l.opening_meter)
   where id = l.id;
  perform public.fn_recompute_reconciliation(p_session_id);
end;
$$;

grant execute on function public.fn_record_closing_meter(uuid, uuid, numeric) to authenticated;
