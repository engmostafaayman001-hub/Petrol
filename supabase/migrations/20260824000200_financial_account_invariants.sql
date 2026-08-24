-- Keep one financial account per supplier and explicitly link fuel to its supplier.
alter table public.fuel_types
  add column if not exists supplier_id uuid references public.suppliers (id) on delete restrict;

create index if not exists fuel_types_supplier_idx on public.fuel_types (supplier_id) where supplier_id is not null;

create unique index if not exists suppliers_station_normalized_name_uq
  on public.suppliers (station_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));