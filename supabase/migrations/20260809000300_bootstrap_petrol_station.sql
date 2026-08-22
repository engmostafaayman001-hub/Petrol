-- Bootstrap the first station for a fresh PETROL deployment, then attach the
-- nominated owner account as its active manager. Safe to run repeatedly.
insert into public.stations (
  id, code, name, legal_name, city, country_code, timezone, currency_code, is_active
) values (
  '11111111-1111-4111-8111-111111111111'::uuid,
  'PETROL-01',
  'محطة التعاون الرئيسية',
  'Al Taawoun Fuel Station',
  'القاهرة',
  'EG',
  'Africa/Cairo',
  'EGP',
  true
)
on conflict (id) do nothing;

insert into public.profiles (id, station_id, full_name, email, role, is_active)
select
  u.id,
  '11111111-1111-4111-8111-111111111111'::uuid,
  coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), 'Mark Ode'),
  lower(u.email),
  'manager'::public.user_role,
  true
from auth.users u
where lower(u.email) = 'markode@gmail.com'
on conflict (id) do update
set station_id = excluded.station_id,
    email = excluded.email,
    role = 'manager'::public.user_role,
    is_active = true;
