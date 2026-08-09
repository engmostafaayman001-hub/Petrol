-- Provision and promote the nominated PETROL owner. This is idempotent: it
-- works whether the account already has a profile or only exists in auth.users.
insert into public.profiles (id, station_id, full_name, email, role, is_active)
select
  u.id,
  s.id,
  coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), 'Mark Ode'),
  lower(u.email),
  'manager'::public.user_role,
  true
from auth.users u
cross join lateral (
  select id
  from public.stations
  where is_active
  order by created_at
  limit 1
) s
where lower(u.email) = 'markode@gmail.com'
on conflict (id) do update
set email = excluded.email,
    role = 'manager'::public.user_role,
    is_active = true;

update public.profiles
set role = 'manager'::public.user_role,
    is_active = true
where lower(email) = 'markode@gmail.com';
