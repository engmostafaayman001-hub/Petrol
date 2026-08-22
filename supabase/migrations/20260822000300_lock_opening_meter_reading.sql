-- Opening meter readings are captured while opening a shift and immutable afterwards.
create or replace function public.fn_guard_reconciliation_line()
returns trigger
language plpgsql
as $$
declare v_status public.reconciliation_status;
begin
  if public.fn_engine_active() then
    return new;
  end if;

  select status into v_status from public.reconciliation_sessions where id = old.session_id;
  if v_status <> 'open' then
    raise exception 'This reconciliation has been submitted; its lines are final.' using errcode = 'restrict_violation';
  end if;

  new.opening_meter        := old.opening_meter;
  new.meter_id             := old.meter_id;
  new.opening_qty          := old.opening_qty;
  new.delivered_qty        := old.delivered_qty;
  new.sold_qty             := old.sold_qty;
  new.adjusted_qty         := old.adjusted_qty;
  new.expected_closing_qty := old.expected_closing_qty;
  new.variance_qty         := old.variance_qty;
  new.variance_pct         := old.variance_pct;
  new.variance_status      := old.variance_status;
  new.writeoff_txn_id      := old.writeoff_txn_id;
  new.actual_closing_qty   := old.actual_closing_qty;
  new.closing_reading_id   := old.closing_reading_id;
  new.reading_source       := old.reading_source;
  new.tank_id              := old.tank_id;
  new.session_id           := old.session_id;

  return new;
end;
$$;