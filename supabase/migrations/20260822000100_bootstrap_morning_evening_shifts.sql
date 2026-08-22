-- Ensure every active station offers the two supported operating periods.
update public.shifts
   set name = 'Morning', shift_period = 'morning', starts_at = '06:00', ends_at = '14:00', is_active = true
 where code = 'A';

update public.shifts
   set name = 'Evening', shift_period = 'evening', starts_at = '14:00', ends_at = '22:00', is_active = true
 where code = 'B';

insert into public.shifts (station_id, code, name, starts_at, ends_at, seq, shift_period, is_active)
select s.id, 'B', 'Evening', '14:00', '22:00',
       coalesce((select max(existing.seq) + 1 from public.shifts existing where existing.station_id = s.id), 2),
       'evening', true
  from public.stations s
 where s.is_active
   and not exists (select 1 from public.shifts existing where existing.station_id = s.id and existing.code = 'B')
   and not exists (select 1 from public.shifts existing where existing.station_id = s.id and existing.seq = coalesce((select max(other.seq) + 1 from public.shifts other where other.station_id = s.id), 2));
