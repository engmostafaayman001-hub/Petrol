-- ==========================================================================
-- 20260901000100 · INTERNAL TANK TRANSFER LOGIC
--
-- Internal tank movement: source and target are updated only in the ledger and
-- a dedicated transfer log. No sales, supplies, debts, sessions or accounting
-- tables are touched by this operation.
-- ===========================================================================

create table public.tank_transfers (
  id                         uuid primary key default gen_random_uuid(),
  station_id                 uuid        not null references public.stations (id) on delete restrict,
  source_tank_id             uuid        not null references public.tanks (id) on delete restrict,
  destination_tank_id        uuid        not null references public.tanks (id) on delete restrict,
  fuel_type_id               uuid        not null references public.fuel_types (id) on delete restrict,
  quantity                   numeric(16, 3) not null check (quantity > 0),
  source_balance_before      numeric(16, 3) not null,
  source_balance_after       numeric(16, 3) not null,
  destination_balance_before numeric(16, 3) not null,
  destination_balance_after  numeric(16, 3) not null,
  note                       text,
  request_token              text,
  source_txn_id              bigint,
  destination_txn_id         bigint,
  created_by                 uuid        references public.profiles (id) on delete set null,
  created_at                 timestamptz not null default now()
);

create unique index tank_transfers_request_token_unique
  on public.tank_transfers (request_token)
  where request_token is not null;

create index tank_transfers_station_idx
  on public.tank_transfers (station_id, created_at desc);

alter table public.tank_transfers enable row level security;

create policy tank_transfers_read on public.tank_transfers
  for select to authenticated
  using (public.app_owns(station_id));

create policy tank_transfers_insert on public.tank_transfers
  for insert to authenticated
  with check (
    public.app_owns(station_id)
    and created_by = auth.uid()
  );

create or replace function public.fn_create_tank_transfer(
  p_station_id          uuid,
  p_source_tank_id      uuid,
  p_destination_tank_id uuid,
  p_quantity            numeric,
  p_business_date       date default current_date,
  p_note                text default null,
  p_request_token       text default null,
  p_actor               uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source          public.tanks%rowtype;
  v_destination     public.tanks%rowtype;
  v_source_balance  numeric(16, 3);
  v_destination_balance numeric(16, 3);
  v_source_after    numeric(16, 3);
  v_destination_after numeric(16, 3);
  v_quantity        numeric(16, 3) := public.fn_vol(p_quantity);
  v_transfer_id     uuid;
  v_actor_id        uuid := coalesce(p_actor, auth.uid());
begin
  if p_station_id is null then
    raise exception 'محطة غير محددة.' using errcode = 'check_violation';
  end if;

  if p_source_tank_id is null or p_destination_tank_id is null then
    raise exception 'يجب تحديد الخزان المصدر والخزان المستهدف.' using errcode = 'check_violation';
  end if;

  if p_source_tank_id = p_destination_tank_id then
    raise exception 'لا يمكن نقل الوقود من خزان إلى نفسه.' using errcode = 'check_violation';
  end if;

  if v_quantity <= 0 then
    raise exception 'يجب إدخال كمية نقل أكبر من صفر.' using errcode = 'check_violation';
  end if;

  if p_request_token is not null then
    select id into v_transfer_id
      from public.tank_transfers
     where request_token = p_request_token
       and station_id = p_station_id
     for update;

    if found then
      return v_transfer_id;
    end if;
  end if;

  select * into v_source
    from public.tanks
   where id = p_source_tank_id
     and station_id = p_station_id
   for update;

  if not found then
    raise exception 'الخزان المصدر غير موجود في هذه المحطة.' using errcode = 'foreign_key_violation';
  end if;

  if not v_source.is_active then
    raise exception 'الخزان المصدر غير نشط.' using errcode = 'check_violation';
  end if;

  select * into v_destination
    from public.tanks
   where id = p_destination_tank_id
     and station_id = p_station_id
   for update;

  if not found then
    raise exception 'الخزان المستهدف غير موجود في هذه المحطة.' using errcode = 'check_violation';
  end if;

  if not v_destination.is_active then
    raise exception 'الخزان المستهدف غير نشط.' using errcode = 'check_violation';
  end if;

  select coalesce(quantity,0) into v_source_balance
    from public.tank_balances
   where tank_id = p_source_tank_id
   for update;

  if v_source_balance is null then
    insert into public.tank_balances (tank_id, station_id, quantity)
    values (p_source_tank_id, p_station_id, 0)
    on conflict (tank_id) do nothing;
    v_source_balance := 0;
  end if;

  select coalesce(quantity,0) into v_destination_balance
    from public.tank_balances
   where tank_id = p_destination_tank_id
   for update;

  if v_destination_balance is null then
    insert into public.tank_balances (tank_id, station_id, quantity)
    values (p_destination_tank_id, p_station_id, 0)
    on conflict (tank_id) do nothing;
    v_destination_balance := 0;
  end if;

  if v_source_balance < v_quantity then
    raise exception 'الرصيد المتاح في الخزان المصدر غير كافٍ.' using errcode = 'check_violation';
  end if;

  v_source_after := public.fn_vol(v_source_balance - v_quantity);
  v_destination_after := public.fn_vol(v_destination_balance + v_quantity);

  insert into public.tank_transfers (
    station_id,
    source_tank_id,
    destination_tank_id,
    fuel_type_id,
    quantity,
    source_balance_before,
    source_balance_after,
    destination_balance_before,
    destination_balance_after,
    note,
    request_token,
    created_by,
    created_at
  ) values (
    p_station_id,
    p_source_tank_id,
    p_destination_tank_id,
    v_source.fuel_type_id,
    v_quantity,
    v_source_balance,
    v_source_after,
    v_destination_balance,
    v_destination_after,
    coalesce(p_note, 'نقل داخلي بين الخزانات'),
    p_request_token,
    v_actor_id,
    now()
  ) returning id into v_transfer_id;

  update public.tank_transfers
     set source_txn_id = public.fn_post_transaction(
           p_source_tank_id,
           'tank_transfer',
           -v_quantity,
           coalesce(p_business_date, current_date),
           null,
           'tank_transfers',
           v_transfer_id,
           coalesce(p_note, 'نقل داخلي بين الخزانات'),
           v_actor_id
         ),
         destination_txn_id = public.fn_post_transaction(
           p_destination_tank_id,
           'tank_transfer',
           v_quantity,
           coalesce(p_business_date, current_date),
           null,
           'tank_transfers',
           v_transfer_id,
           coalesce(p_note, 'نقل داخلي بين الخزانات'),
           v_actor_id
         )
   where id = v_transfer_id;

  return v_transfer_id;
end;
$$;

revoke all on function public.fn_create_tank_transfer(uuid, uuid, uuid, numeric, date, text, text, uuid) from public, anon;
grant execute on function public.fn_create_tank_transfer(uuid, uuid, uuid, numeric, date, text, text, uuid) to authenticated;

create or replace function public.fn_guard_inventory_source()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source_id is null or coalesce(btrim(new.source_table), '') = '' then
    raise exception 'كل حركة مخزون يجب أن ترتبط بمصدر محدد.' using errcode = 'check_violation';
  end if;

  if new.reverses_txn_id is null
     and new.txn_type::text <> 'tank_transfer'
     and exists (
       select 1
       from public.inventory_transactions prior
       where prior.source_table = new.source_table
         and prior.source_id = new.source_id
         and prior.txn_type = new.txn_type
         and prior.reverses_txn_id is null
     ) then
    raise exception 'تمت معالجة حركة المخزون لهذا المصدر مسبقًا.' using errcode = 'unique_violation';
  end if;

  if new.reverses_txn_id is not null then
    return new;
  end if;

  case new.txn_type::text
    when 'delivery' then
      if new.source_table <> 'deliveries' or new.quantity_delta <= 0 then
        raise exception 'إضافة المخزون يجب أن تكون من توريد فعلي موجب.' using errcode = 'check_violation';
      end if;
    when 'variance_writeoff' then
      if new.source_table <> 'reconciliation_meter_readings' or new.quantity_delta >= 0 then
        raise exception 'خصم المخزون يجب أن يكون فرق عداد سالبًا مرتبطًا بقراءة عداد.' using errcode = 'check_violation';
      end if;
    when 'adjustment' then
      if new.source_table <> 'adjustments' then
        raise exception 'تسوية المخزون يجب أن ترتبط بطلب تسوية معتمد.' using errcode = 'check_violation';
      end if;
    when 'tank_transfer' then
      if new.source_table <> 'tank_transfers' or new.quantity_delta = 0 then
        raise exception 'نقل الخزانات يجب أن يأتي من سجل نقل داخلي.' using errcode = 'check_violation';
      end if;
    when 'sale' then
      raise exception 'المبيعات المسجلة لا تخصم المخزون؛ فرق العداد هو المصدر الوحيد للخصم.' using errcode = 'check_violation';
    else
      raise exception 'نوع حركة مخزون غير مسموح به في مسار الوقود الحالي.' using errcode = 'check_violation';
  end case;

  return new;
end;
$$;

drop trigger if exists trg_guard_inventory_source on public.inventory_transactions;
create trigger trg_guard_inventory_source
  before insert on public.inventory_transactions
  for each row execute function public.fn_guard_inventory_source();
