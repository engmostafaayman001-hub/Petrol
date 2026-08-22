-- Controlled operational reset voids historical sales and deliveries without
-- posting inventory reversals against the current tank balances.
create or replace function public.fn_movement_void_reversal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.operational_reset', true) = 'on' then
    return null;
  end if;

  if new.status = 'voided' and old.status = 'active' and old.ledger_txn_id is not null then
    perform public.fn_reverse_transaction(
      old.ledger_txn_id,
      initcap(tg_table_name) || ' voided: ' || new.void_reason,
      new.voided_by
    );
  end if;
  return null;
end;
$$;
