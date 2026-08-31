-- Store all invoice items independently from operational data.
alter table public.extra_sales
  add column if not exists items jsonb not null default '[]'::jsonb;

update public.extra_sales
set items = jsonb_build_array(jsonb_build_object(
  'item_code', item_code,
  'item_name', coalesce(item_name, sale_description),
  'item_category_code', item_category_code,
  'item_description', coalesce(item_description, sale_description),
  'item_unit', coalesce(item_unit, 'قطعة'),
  'item_quantity', coalesce(item_quantity, 1),
  'item_unit_price', coalesce(item_unit_price, amount),
  'item_discount', coalesce(item_discount, 0),
  'subtotal', coalesce(subtotal, amount),
  'net_amount', coalesce(net_amount, amount)
))
where jsonb_array_length(items) = 0;

alter table public.extra_sales
  add constraint extra_sales_items_array_check check (jsonb_typeof(items) = 'array');
