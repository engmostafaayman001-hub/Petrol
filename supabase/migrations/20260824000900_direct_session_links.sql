-- Direct session links make the accounting period explicit while preserving
-- legacy records that cannot be mapped unambiguously after a reopened shift.
alter table public.sales
  add column if not exists session_id uuid references public.reconciliation_sessions (id) on delete restrict;

alter table public.deliveries
  add column if not exists session_id uuid references public.reconciliation_sessions (id) on delete restrict;

create index if not exists sales_session_idx
  on public.sales (session_id, created_at desc)
  where session_id is not null;

create index if not exists deliveries_session_idx
  on public.deliveries (session_id, created_at desc)
  where session_id is not null;

-- The operational immutability trigger must allow this metadata-only backfill.
-- All business fields remain byte-for-byte unchanged.
create or replace function public.fn_guard_operational_record()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'voided' then
    raise exception 'This record has already been voided and can no longer change.'
      using errcode = 'restrict_violation';
  end if;

  if old.status = 'active' and new.status = 'active'
     and (to_jsonb(new) - 'session_id') = (to_jsonb(old) - 'session_id') then
    return new;
  end if;

  if new.status is distinct from 'voided'::public.record_status then
    raise exception 'Operational records cannot be edited. Void the record and capture a corrected one.'
      using errcode = 'restrict_violation';
  end if;

  if coalesce(btrim(new.void_reason), '') = '' then
    raise exception 'A reason is required when voiding a record.'
      using errcode = 'check_violation';
  end if;

  new.station_id := old.station_id;
  new.tank_id := old.tank_id;
  new.fuel_type_id := old.fuel_type_id;
  new.quantity := old.quantity;
  new.business_date := old.business_date;
  new.shift_id := old.shift_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.ledger_txn_id := old.ledger_txn_id;
  new.voided_by := coalesce(new.voided_by, auth.uid());
  new.voided_at := coalesce(new.voided_at, now());
  return new;
end;
$$;

-- Backfill only dates with one possible session. Ambiguous legacy rows remain
-- queryable through business_date + shift_id and are never assigned randomly.
-- The guard is paused only for this metadata-only maintenance operation.
alter table public.sales disable trigger trg_sales_guard;
alter table public.deliveries disable trigger trg_deliveries_guard;

update public.sales s
set session_id = r.id
from public.reconciliation_sessions r
where s.session_id is null
  and s.status = 'active'
  and r.station_id = s.station_id
  and r.business_date = s.business_date
  and r.shift_id = s.shift_id
  and (select count(*) from public.reconciliation_sessions r2
       where r2.station_id = s.station_id
         and r2.business_date = s.business_date
         and r2.shift_id = s.shift_id) = 1;

alter table public.sales enable trigger trg_sales_guard;
alter table public.deliveries enable trigger trg_deliveries_guard;

update public.deliveries d
set session_id = r.id
from public.reconciliation_sessions r
where d.session_id is null
  and d.status = 'active'
  and r.station_id = d.station_id
  and r.business_date = d.business_date
  and r.shift_id = d.shift_id
  and (select count(*) from public.reconciliation_sessions r2
       where r2.station_id = d.station_id
         and r2.business_date = d.business_date
         and r2.shift_id = d.shift_id) = 1;

create or replace function public.fn_attach_open_session()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.reconciliation_sessions%rowtype;
begin
  if new.session_id is null then
    select * into v_session
      from public.reconciliation_sessions
     where station_id = new.station_id
       and business_date = new.business_date
       and shift_id = new.shift_id
       and status = 'open'
     order by opened_at desc
     limit 1;
  else
    select * into v_session
      from public.reconciliation_sessions
     where id = new.session_id
       and station_id = new.station_id
       and business_date = new.business_date
       and shift_id = new.shift_id
       and status = 'open';
  end if;

  if not found then
    raise exception 'لا توجد جلسة مفتوحة لهذه العملية. افتح الوردية أولاً.'
      using errcode = 'restrict_violation';
  end if;

  new.session_id := v_session.id;
  return new;
end;
$$;

drop trigger if exists trg_sales_attach_open_session on public.sales;
create trigger trg_sales_attach_open_session
  before insert on public.sales
  for each row execute function public.fn_attach_open_session();

drop trigger if exists trg_deliveries_attach_open_session on public.deliveries;
create trigger trg_deliveries_attach_open_session
  before insert on public.deliveries
  for each row execute function public.fn_attach_open_session();

grant execute on function public.fn_attach_open_session() to authenticated;

-- Refresh the pre-existing read models so newly added columns are visible to
-- PostgREST. PostgreSQL expands `table.*` when a view is first created, not
-- when columns are added later.
drop view if exists public.v_sales;
create view public.v_sales
with (security_invoker = true) as
select
  s.*,
  t.code as tank_code, t.name as tank_name,
  f.code as fuel_code, f.name as fuel_name, f.color_hex as fuel_color,
  sh.code as shift_code, sh.name as shift_name,
  p.full_name as created_by_name,
  pv.full_name as voided_by_name
from public.sales s
join public.tanks t on t.id = s.tank_id
join public.fuel_types f on f.id = s.fuel_type_id
join public.shifts sh on sh.id = s.shift_id
left join public.profiles p on p.id = s.created_by
left join public.profiles pv on pv.id = s.voided_by;

drop view if exists public.v_deliveries;
create view public.v_deliveries
with (security_invoker = true) as
select
  d.*,
  t.code as tank_code, t.name as tank_name,
  f.code as fuel_code, f.name as fuel_name, f.color_hex as fuel_color,
  sup.name as supplier_name,
  sh.code as shift_code, sh.name as shift_name,
  p.full_name as created_by_name,
  pv.full_name as voided_by_name,
  round(coalesce(d.unit_cost, 0) * d.quantity, 2) as total_cost
from public.deliveries d
join public.tanks t on t.id = d.tank_id
join public.fuel_types f on f.id = d.fuel_type_id
join public.shifts sh on sh.id = d.shift_id
left join public.suppliers sup on sup.id = d.supplier_id
left join public.profiles p on p.id = d.created_by
left join public.profiles pv on pv.id = d.voided_by;