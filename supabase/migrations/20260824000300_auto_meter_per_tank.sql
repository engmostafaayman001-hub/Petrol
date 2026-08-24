-- Every active tank must have one linked counter whose opening and closing
-- readings form the two readings required for each reconciliation cycle.
create or replace function public.fn_create_tank_pump_meter()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_active and new.status = 'operational' then
    insert into public.pump_meters (station_id, tank_id, code, name)
    values (new.station_id, new.id, 'M-' || new.code, 'عداد ' || new.name)
    on conflict (station_id, tank_id) do update
      set is_active = true, updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tanks_create_pump_meter on public.tanks;
create trigger trg_tanks_create_pump_meter
  after insert or update of code, name, status, is_active on public.tanks
  for each row execute function public.fn_create_tank_pump_meter();

insert into public.pump_meters (station_id, tank_id, code, name)
select t.station_id, t.id, 'M-' || t.code, 'عداد ' || t.name
from public.tanks t
where t.is_active and t.status = 'operational'
on conflict (station_id, tank_id) do update
  set is_active = true, updated_at = now();