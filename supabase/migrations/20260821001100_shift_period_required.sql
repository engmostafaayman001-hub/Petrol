-- Keep every active shift explicitly classified as morning or evening.
update public.shifts
   set shift_period = case when seq = 1 then 'morning' else 'evening' end
 where shift_period is null or shift_period not in ('morning', 'evening');

alter table public.shifts
  alter column shift_period set default 'evening',
  alter column shift_period set not null;

comment on column public.shifts.shift_period is 'Operational period: morning or evening.';
