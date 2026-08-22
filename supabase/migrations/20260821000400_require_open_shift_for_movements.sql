-- Movements must never auto-create a shift after meter readings became mandatory.
create or replace function public.fn_refresh_open_reconciliation_from_ledger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_id uuid;
begin
  select id into v_session_id
    from public.reconciliation_sessions
   where station_id = new.station_id
     and business_date = new.business_date
     and shift_id = new.shift_id
     and status = 'open'
   limit 1;

  if v_session_id is null then
    raise exception 'لا توجد جلسة مفتوحة لهذه الوردية. سجل قراءة بداية العداد وافتح الوردية أولاً.'
      using errcode = 'restrict_violation';
  end if;

  perform public.fn_recompute_reconciliation(v_session_id);
  return null;
end;
$$;
