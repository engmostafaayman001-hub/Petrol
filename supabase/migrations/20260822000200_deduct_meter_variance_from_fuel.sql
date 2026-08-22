-- Meter variance is the extra or missing quantity versus recorded sales.
-- A positive meter variance means more fuel left the tank, so the ledger
-- adjustment must be negative.
create or replace function public.fn_post_reconciliation_variance(
  p_session_id uuid,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.reconciliation_sessions%rowtype;
  l record;
  v_txn bigint;
begin
  select * into s from public.reconciliation_sessions where id = p_session_id;
  if not found then raise exception 'جلسة الوردية غير موجودة.' using errcode = 'no_data_found'; end if;
  perform public.fn_engine_on();

  for l in
    select * from public.reconciliation_lines
     where session_id = p_session_id
       and variance_qty is not null
       and variance_qty <> 0
       and writeoff_txn_id is null
  loop
    v_txn := public.fn_post_transaction(
      l.tank_id, 'variance_writeoff', public.fn_vol(-l.variance_qty), s.business_date, s.shift_id,
      'reconciliation_lines', l.id,
      'Measured meter variance recorded at reconciliation', p_actor
    );
    update public.reconciliation_lines set writeoff_txn_id = v_txn where id = l.id;
  end loop;
end;
$$;

grant execute on function public.fn_post_reconciliation_variance(uuid, uuid) to authenticated;
