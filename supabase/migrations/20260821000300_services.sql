-- Ancillary services sold during the shared open shift.
create table public.service_sales (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations (id) on delete restrict,
  session_id uuid not null references public.reconciliation_sessions (id) on delete restrict,
  shift_id uuid not null references public.shifts (id) on delete restrict,
  business_date date not null,
  service_type text not null check (service_type in ('car_wash', 'oil_change', 'carpet_wash', 'blanket_wash', 'other')),
  service_name text,
  vehicle_type text,
  amount numeric(14, 2) not null check (amount > 0),
  status public.record_status not null default 'active',
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_sales_other_name check (service_type <> 'other' or char_length(btrim(coalesce(service_name, ''))) between 1 and 120),
  constraint service_sales_non_other_name check (service_type = 'other' or service_name is null)
);

create index service_sales_current_idx on public.service_sales (station_id, session_id, created_at desc);
create index service_sales_created_by_idx on public.service_sales (created_by);

create trigger trg_service_sales_touch
  before update on public.service_sales
  for each row execute function public.fn_touch_updated_at();

alter table public.service_sales enable row level security;
create policy service_sales_read on public.service_sales
  for select to authenticated using (public.app_owns(station_id));
create policy service_sales_insert on public.service_sales
  for insert to authenticated with check (
    public.app_owns(station_id) and created_by = auth.uid() and status = 'active'
  );
create policy service_sales_update on public.service_sales
  for update to authenticated
  using (public.app_owns(station_id) and public.app_is_manager())
  with check (public.app_owns(station_id) and public.app_is_manager());

revoke delete on public.service_sales from anon, authenticated;

create or replace function public.fn_create_service_sale(
  p_station_id uuid,
  p_service_type text,
  p_service_name text,
  p_vehicle_type text,
  p_amount numeric,
  p_operator_id uuid default null
)
returns public.service_sales
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.reconciliation_sessions%rowtype;
  v_service public.service_sales%rowtype;
  v_operator uuid := coalesce(p_operator_id, auth.uid());
begin
  if not public.app_owns(p_station_id) then
    raise exception 'لا تملك صلاحية إضافة خدمات لهذه المحطة.' using errcode = 'insufficient_privilege';
  end if;
  if p_service_type not in ('car_wash', 'oil_change', 'carpet_wash', 'blanket_wash', 'other') then
    raise exception 'نوع الخدمة غير صحيح.' using errcode = 'check_violation';
  end if;
  if p_service_type = 'other' and char_length(btrim(coalesce(p_service_name, ''))) = 0 then
    raise exception 'اسم الخدمة مطلوب عند اختيار أخرى.' using errcode = 'check_violation';
  end if;
  if p_service_type <> 'other' and p_service_name is not null then
    raise exception 'اسم الخدمة الإضافي يستخدم مع نوع أخرى فقط.' using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'المبلغ يجب أن يكون أكبر من صفر.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_operator and p.station_id = p_station_id and p.is_active) then
    raise exception 'المستخدم المسؤول غير صالح.' using errcode = 'insufficient_privilege';
  end if;

  select * into s from public.reconciliation_sessions
   where station_id = p_station_id and status = 'open'
   order by opened_at desc limit 1;
  if not found then
    raise exception 'لا توجد جلسة مفتوحة حالياً. افتح وردية قبل إضافة خدمة.' using errcode = 'restrict_violation';
  end if;

  insert into public.service_sales (
    station_id, session_id, shift_id, business_date, service_type, service_name,
    vehicle_type, amount, created_by
  ) values (
    p_station_id, s.id, s.shift_id, s.business_date, p_service_type,
    case when p_service_type = 'other' then btrim(p_service_name) else null end,
    nullif(btrim(p_vehicle_type), ''), round(p_amount, 2), v_operator
  ) returning * into v_service;
  return v_service;
end;
$$;

create or replace function public.fn_current_open_services(p_station_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s public.reconciliation_sessions%rowtype;
  v_rows jsonb;
begin
  if not public.app_owns(p_station_id) then
    raise exception 'You do not have access to this station.' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.reconciliation_sessions
   where station_id = p_station_id and status = 'open'
   order by opened_at desc limit 1;
  if not found then
    return jsonb_build_object('session', null, 'services', '[]'::jsonb, 'total', 0, 'count', 0);
  end if;
  select coalesce(jsonb_agg(row_to_json(q) order by q.created_at desc), '[]'::jsonb) into v_rows
    from (
      select x.*, p.full_name as created_by_name,
             st.name as station_name
        from public.service_sales x
        left join public.profiles p on p.id = x.created_by
        join public.stations st on st.id = x.station_id
       where x.station_id = s.station_id and x.session_id = s.id and x.status = 'active'
    ) q;
  return jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'business_date', s.business_date, 'shift_id', s.shift_id,
      'status', s.status, 'opened_at', s.opened_at, 'opened_by', s.opened_by),
    'services', v_rows,
    'total', coalesce((select sum((item->>'amount')::numeric) from jsonb_array_elements(v_rows) item), 0),
    'count', jsonb_array_length(v_rows)
  );
end;
$$;

create or replace function public.fn_current_open_service_detail(p_station_id uuid, p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  if not public.app_owns(p_station_id) then
    raise exception 'You do not have access to this station.' using errcode = 'insufficient_privilege';
  end if;
  select row_to_json(q)::jsonb into v_result
    from (
      select x.*, p.full_name as created_by_name, st.name as station_name,
             r.opened_at, r.opened_by as session_opened_by
        from public.service_sales x
        join public.reconciliation_sessions r on r.id = x.session_id and r.status = 'open'
        left join public.profiles p on p.id = x.created_by
        join public.stations st on st.id = x.station_id
       where x.station_id = p_station_id and x.id = p_service_id and x.status = 'active'
    ) q;
  return v_result;
end;
$$;

grant execute on function public.fn_create_service_sale(uuid, text, text, text, numeric, uuid) to authenticated;
grant execute on function public.fn_current_open_services(uuid) to authenticated;
grant execute on function public.fn_current_open_service_detail(uuid, uuid) to authenticated;
