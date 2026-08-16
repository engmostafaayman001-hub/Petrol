-- Keep an open shift calculated from the ledger after each stock movement.
create or replace function public.fn_refresh_open_reconciliation_from_ledger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_session_id uuid;
begin
  for v_session_id in select id from public.reconciliation_sessions
    where station_id = new.station_id and business_date = new.business_date
      and shift_id = new.shift_id and status = 'open'
  loop
    perform public.fn_recompute_reconciliation(v_session_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_refresh_open_reconciliation_from_ledger on public.inventory_transactions;
create trigger trg_refresh_open_reconciliation_from_ledger after insert on public.inventory_transactions
for each row execute function public.fn_refresh_open_reconciliation_from_ledger();
