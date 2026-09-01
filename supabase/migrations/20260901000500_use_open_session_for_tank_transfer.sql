-- ---------------------------------------------------------------------------
-- Internal transfers must be posted into the station's actual open session.
-- Previously p_shift_id was passed as NULL, so the ledger refresh trigger
-- could not find the already-open reconciliation session.
-- ---------------------------------------------------------------------------

create or replace function public.fn_create_tank_transfer(
  p_station_id uuid, p_source_tank_id uuid, p_destination_tank_id uuid,
  p_quantity numeric, p_business_date date default current_date,
  p_note text default null, p_request_token text default null,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.tanks%rowtype;
  v_destination public.tanks%rowtype;
  v_source_balance numeric(16,3);
  v_destination_balance numeric(16,3);
  v_source_after numeric(16,3);
  v_destination_after numeric(16,3);
  v_quantity numeric(16,3) := public.fn_vol(p_quantity);
  v_transfer_id uuid;
  v_actor_id uuid := coalesce(p_actor, auth.uid());
  v_shift_id uuid;
  v_business_date date;
begin
  if p_station_id is null then
    raise exception 'محطة غير محددة.' using errcode = 'check_violation';
  end if;
  if public.app_jwt_role() <> 'service_role' and not public.app_owns(p_station_id) then
    raise exception 'لا تملك صلاحية الوصول إلى هذه المحطة.' using errcode = 'insufficient_privilege';
  end if;
  if auth.uid() is not null and v_actor_id <> auth.uid() then
    raise exception 'هوية المستخدم غير صالحة.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.profiles where id = v_actor_id and station_id = p_station_id and is_active) then
    raise exception 'المستخدم الحالي غير صالح أو غير نشط.' using errcode = 'insufficient_privilege';
  end if;
  if p_source_tank_id is null or p_destination_tank_id is null then
    raise exception 'يجب تحديد الخزان المصدر والخزان المستهدف.' using errcode = 'check_violation';
  end if;
  if p_source_tank_id = p_destination_tank_id then
    raise exception 'لا يمكن نقل الوقود من خزان إلى نفسه.' using errcode = 'check_violation';
  end if;
  if v_quantity is null or v_quantity <= 0 then
    raise exception 'يجب إدخال كمية نقل أكبر من صفر.' using errcode = 'check_violation';
  end if;

  -- Use the actual open session rather than the browser's clock or NULL.
  select shift_id, business_date into v_shift_id, v_business_date
    from public.reconciliation_sessions
   where station_id = p_station_id and status = 'open'
   order by business_date desc, shift_seq desc
   limit 1
   for update;
  if v_shift_id is null then
    raise exception 'لا توجد جلسة مفتوحة للمحطة. افتح الوردية أولاً.' using errcode = 'restrict_violation';
  end if;

  if p_request_token is not null then
    select id into v_transfer_id from public.tank_transfers
     where request_token = p_request_token and station_id = p_station_id for update;
    if found then return v_transfer_id; end if;
  end if;

  select * into v_source from public.tanks
   where id = p_source_tank_id and station_id = p_station_id for update;
  if not found then raise exception 'الخزان المصدر غير موجود في هذه المحطة.' using errcode = 'foreign_key_violation'; end if;
  if not v_source.is_active then raise exception 'الخزان المصدر غير نشط.' using errcode = 'check_violation'; end if;

  select * into v_destination from public.tanks
   where id = p_destination_tank_id and station_id = p_station_id for update;
  if not found then raise exception 'الخزان المستهدف غير موجود في هذه المحطة.' using errcode = 'check_violation'; end if;
  if not v_destination.is_active then raise exception 'الخزان المستهدف غير نشط.' using errcode = 'check_violation'; end if;

  -- Fuel types are audit snapshots only; different types are intentionally allowed.
  select coalesce(quantity, 0) into v_source_balance from public.tank_balances
   where tank_id = p_source_tank_id for update;
  if v_source_balance is null then
    insert into public.tank_balances (tank_id, station_id, quantity)
    values (p_source_tank_id, p_station_id, 0) on conflict (tank_id) do nothing;
    v_source_balance := 0;
  end if;
  select coalesce(quantity, 0) into v_destination_balance from public.tank_balances
   where tank_id = p_destination_tank_id for update;
  if v_destination_balance is null then
    insert into public.tank_balances (tank_id, station_id, quantity)
    values (p_destination_tank_id, p_station_id, 0) on conflict (tank_id) do nothing;
    v_destination_balance := 0;
  end if;
  if v_source_balance < v_quantity then
    raise exception 'الرصيد المتاح في الخزان المصدر غير كافٍ.' using errcode = 'check_violation';
  end if;

  v_source_after := public.fn_vol(v_source_balance - v_quantity);
  v_destination_after := public.fn_vol(v_destination_balance + v_quantity);
  insert into public.tank_transfers (
    station_id, source_tank_id, destination_tank_id, fuel_type_id,
    source_fuel_type_id, destination_fuel_type_id, quantity,
    source_balance_before, source_balance_after, destination_balance_before,
    destination_balance_after, note, request_token, created_by, created_at
  ) values (
    p_station_id, p_source_tank_id, p_destination_tank_id, v_source.fuel_type_id,
    v_source.fuel_type_id, v_destination.fuel_type_id, v_quantity,
    v_source_balance, v_source_after, v_destination_balance, v_destination_after,
    coalesce(p_note, 'نقل داخلي بين الخزانات'), p_request_token, v_actor_id, now()
  ) returning id into v_transfer_id;

  update public.tank_transfers set
    source_txn_id = public.fn_post_transaction(
      p_source_tank_id, 'tank_transfer', -v_quantity, v_business_date, v_shift_id,
      'tank_transfers', v_transfer_id, coalesce(p_note, 'نقل داخلي بين الخزانات'), v_actor_id
    ),
    destination_txn_id = public.fn_post_transaction(
      p_destination_tank_id, 'tank_transfer', v_quantity, v_business_date, v_shift_id,
      'tank_transfers', v_transfer_id, coalesce(p_note, 'نقل داخلي بين الخزانات'), v_actor_id
    ) where id = v_transfer_id;
  return v_transfer_id;
end;
$$;

revoke all on function public.fn_create_tank_transfer(uuid, uuid, uuid, numeric, date, text, text, uuid) from public, anon;
grant execute on function public.fn_create_tank_transfer(uuid, uuid, uuid, numeric, date, text, text, uuid) to authenticated;
