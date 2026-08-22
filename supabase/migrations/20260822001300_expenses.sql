-- Cash expenses belong to a reconciliation session but never change tank stock.
create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  station_id      uuid not null references public.stations (id) on delete restrict,
  session_id      uuid not null references public.reconciliation_sessions (id) on delete restrict,
  shift_id        uuid not null references public.shifts (id) on delete restrict,
  business_date   date not null,
  category        text not null,
  description     text not null,
  amount          numeric(14, 2) not null check (amount > 0),
  status          public.adjustment_status not null default 'pending',
  created_by      uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  decided_by      uuid references public.profiles (id) on delete set null,
  decided_at      timestamptz,
  decision_note   text,
  constraint expenses_category_len check (char_length(btrim(category)) between 2 and 60),
  constraint expenses_description_len check (char_length(btrim(description)) between 2 and 240)
);

create index expenses_station_date_idx on public.expenses (station_id, business_date desc, created_at desc);
create index expenses_session_idx on public.expenses (session_id, status, created_at desc);

alter table public.expenses enable row level security;
create policy expenses_read on public.expenses
  for select to authenticated using (public.app_owns(station_id));
create policy expenses_create on public.expenses
  for insert to authenticated
  with check (
    public.app_owns(station_id)
    and created_by = auth.uid()
    and status = 'pending'
  );
create policy expenses_manager_update on public.expenses
  for update to authenticated
  using (public.app_owns(station_id) and public.app_is_manager())
  with check (public.app_owns(station_id) and public.app_is_manager());

create or replace function public.fn_guard_expense_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'pending' then
    raise exception 'لا يمكن تعديل مصروف تم اتخاذ قرار بشأنه.' using errcode = 'restrict_violation';
  end if;
  if not public.app_is_manager() and not exists (select 1 from public.profiles where id = nullif(current_setting('app.expense_actor', true), '')::uuid and station_id = old.station_id and role = 'manager' and is_active) then
    raise exception 'اعتماد المصروفات متاح لمدير المحطة فقط.' using errcode = 'insufficient_privilege';
  end if;
  new.station_id := old.station_id;
  new.session_id := old.session_id;
  new.shift_id := old.shift_id;
  new.business_date := old.business_date;
  new.category := old.category;
  new.description := old.description;
  new.amount := old.amount;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.decided_by := coalesce(new.decided_by, auth.uid());
  new.decided_at := coalesce(new.decided_at, now());
  return new;
end;
$$;

create trigger trg_expenses_decision
  before update on public.expenses
  for each row execute function public.fn_guard_expense_decision();

create or replace function public.fn_create_expense(
  p_station_id uuid,
  p_session_id uuid,
  p_category text,
  p_description text,
  p_amount numeric,
  p_actor_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.reconciliation_sessions%rowtype;
  v_id uuid;
  v_actor uuid := coalesce(p_actor_id, auth.uid());
begin
  if not exists (select 1 from public.profiles where id = v_actor and station_id = p_station_id and is_active) then
    raise exception 'المستخدم الحالي غير صالح أو غير نشط.' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.reconciliation_sessions where id = p_session_id and station_id = p_station_id for share;
  if not found or s.status <> 'open' then
    raise exception 'يجب ربط المصروف بوردية مفتوحة.' using errcode = 'restrict_violation';
  end if;
  insert into public.expenses (station_id, session_id, shift_id, business_date, category, description, amount, status, created_by)
  values (p_station_id, s.id, s.shift_id, s.business_date, btrim(p_category), btrim(p_description), p_amount, 'pending', v_actor)
  returning id into v_id;
  return v_id;
end;
$$;

grant select, insert on public.expenses to authenticated;
grant execute on function public.fn_create_expense(uuid, uuid, text, text, numeric, uuid) to authenticated;

create or replace function public.fn_decide_expense(
  p_expense_id uuid,
  p_approved boolean,
  p_actor_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.expenses%rowtype;
begin
  select * into e from public.expenses where id = p_expense_id for update;
  if not found then raise exception 'المصروف غير موجود.' using errcode = 'no_data_found'; end if;
  if not exists (select 1 from public.profiles where id = p_actor_id and station_id = e.station_id and role = 'manager' and is_active) then
    raise exception 'اعتماد المصروفات متاح لمدير المحطة فقط.' using errcode = 'insufficient_privilege';
  end if;
  if e.status <> 'pending' then raise exception 'تم اتخاذ قرار بشأن هذا المصروف بالفعل.' using errcode = 'restrict_violation'; end if;
  perform set_config('app.expense_actor', p_actor_id::text, true);
  update public.expenses
     set status = case when p_approved then 'approved'::public.adjustment_status else 'rejected'::public.adjustment_status end,
         decided_by = p_actor_id, decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = p_expense_id;
end;
$$;

grant execute on function public.fn_decide_expense(uuid, boolean, uuid, text) to authenticated;
