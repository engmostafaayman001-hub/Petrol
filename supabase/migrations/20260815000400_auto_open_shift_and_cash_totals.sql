-- Open the matching reconciliation as soon as a control, sensor gateway or
-- operator posts a stock movement. The function is idempotent per shift.
create or replace function public.fn_refresh_open_reconciliation_from_ledger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_session_id uuid;
begin
  v_session_id := public.fn_open_reconciliation(new.station_id, new.business_date, new.shift_id);
  perform public.fn_recompute_reconciliation(v_session_id);
  return null;
end;
$$;

create or replace function public.fn_reconciliation_cash_total(p_session_id uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select round(coalesce(sum(s.gross_amount), 0), 2)
  from public.reconciliation_sessions r
  left join public.sales s on s.station_id = r.station_id
    and s.business_date = r.business_date and s.shift_id = r.shift_id and s.status = 'active'
  where r.id = p_session_id
$$;
