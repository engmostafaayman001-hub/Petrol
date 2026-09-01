-- ---------------------------------------------------------------------------
-- 20260901000200 · ALLOW ACTIVE TANK TRANSFERS THROUGH LEDGER
--
-- Tank-transfer inventory movements are internal-only and should be allowed for
-- active tanks even when their operational status is not 'operational'. Other
-- inventory movements remain restricted to tanks in service.
-- ---------------------------------------------------------------------------

create or replace function public.fn_post_transaction(
  p_tank_id       uuid,
  p_txn_type      public.txn_type,
  p_delta         numeric,
  p_business_date date,
  p_shift_id      uuid,
  p_source_table  text,
  p_source_id     uuid,
  p_note          text default null,
  p_actor         uuid default null,
  p_reverses      bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tank      public.tanks%rowtype;
  v_settings  public.system_settings%rowtype;
  v_shift_seq smallint := 0;
  v_current   numeric(16, 3);
  v_new       numeric(16, 3);
  v_delta     numeric(16, 3) := public.fn_vol(p_delta);
  v_txn_id    bigint;
begin
  if v_delta = 0 then
    raise exception 'A zero-quantity movement cannot be posted.'
      using errcode = 'check_violation';
  end if;

  select * into v_tank from public.tanks where id = p_tank_id;
  if not found then
    raise exception 'The selected tank does not exist.' using errcode = 'foreign_key_violation';
  end if;

  if not v_tank.is_active then
    raise exception 'Tank % is not active and cannot receive movements.', v_tank.code
      using errcode = 'check_violation';
  end if;

  if v_tank.status <> 'operational' and p_txn_type::text <> 'tank_transfer' then
    raise exception 'Tank % is not in service and cannot receive movements.', v_tank.code
      using errcode = 'check_violation';
  end if;

  select * into v_settings from public.system_settings where station_id = v_tank.station_id;

  if p_shift_id is not null then
    select seq into v_shift_seq
      from public.shifts
     where id = p_shift_id and station_id = v_tank.station_id;

    if v_shift_seq is null then
      raise exception 'The selected shift does not belong to this station.'
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  select quantity into v_current
    from public.tank_balances
   where tank_id = p_tank_id
     for update;

  if v_current is null then
    insert into public.tank_balances (tank_id, station_id, quantity)
    values (p_tank_id, v_tank.station_id, 0)
    on conflict (tank_id) do nothing;
    v_current := 0;
  end if;

  v_new := public.fn_vol(v_current + v_delta);

  if v_new < 0 and not coalesce(v_settings.allow_negative_balance, false) then
    raise exception
      'This movement would take tank % to % units. Stock cannot go negative — check for a missing delivery.',
      v_tank.code, v_new
      using errcode = 'check_violation';
  end if;

  if v_delta > 0
     and coalesce(v_settings.enforce_tank_capacity, true)
     and v_new > v_tank.capacity then
    raise exception
      'This movement would put % units into tank %, which holds at most % units (currently %).',
      v_delta, v_tank.code, v_tank.capacity, v_current
      using errcode = 'check_violation';
  end if;

  insert into public.inventory_transactions (
    station_id, tank_id, fuel_type_id, txn_type, quantity_delta,
    business_date, shift_id, shift_seq, running_balance,
    source_table, source_id, reverses_txn_id, note, created_by
  ) values (
    v_tank.station_id, p_tank_id, v_tank.fuel_type_id, p_txn_type, v_delta,
    p_business_date, p_shift_id, coalesce(v_shift_seq, 0), v_new,
    p_source_table, p_source_id, p_reverses, p_note, coalesce(p_actor, auth.uid())
  )
  returning id into v_txn_id;

  update public.tank_balances
     set quantity         = v_new,
         last_txn_id      = v_txn_id,
         last_movement_at = now(),
         updated_at       = now()
   where tank_id = p_tank_id;

  return v_txn_id;
end;
$$;
