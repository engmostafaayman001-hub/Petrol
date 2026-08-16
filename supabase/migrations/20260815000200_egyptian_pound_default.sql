-- Egyptian pound is the default station currency for new and existing setups.
alter table public.stations alter column currency_code set default 'EGP';
update public.stations set currency_code = 'EGP' where currency_code = 'USD';
