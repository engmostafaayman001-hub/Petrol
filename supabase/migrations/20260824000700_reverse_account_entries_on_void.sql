-- Keep customer and supplier balances aligned with active operational records.
create or replace function public.fn_reverse_customer_sale_account_on_void()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_amount numeric;
begin
  if old.status = 'active' and new.status = 'voided' and old.customer_id is not null then
    select coalesce(sum(debit), 0) into v_amount
    from public.account_transactions
    where reference_id = old.id and transaction_type = 'sale' and customer_id = old.customer_id;
    if v_amount > 0 and not exists (
      select 1 from public.account_transactions
      where reference_id = old.id and transaction_type = 'adjustment' and customer_id = old.customer_id and credit = v_amount
    ) then
      insert into public.account_transactions (station_id, account_type, customer_id, transaction_type, credit, business_date, reference_id, created_by, notes)
      values (old.station_id, 'customer', old.customer_id, 'adjustment', v_amount, new.business_date, old.id, new.created_by, 'عكس مديونية بيع ملغى');
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.fn_reverse_supplier_delivery_account_on_void()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_amount numeric;
begin
  if old.status = 'active' and new.status = 'voided' and old.supplier_id is not null then
    select coalesce(sum(credit), 0) into v_amount
    from public.account_transactions
    where reference_id = old.id and transaction_type = 'delivery' and supplier_id = old.supplier_id;
    if v_amount > 0 and not exists (
      select 1 from public.account_transactions
      where reference_id = old.id and transaction_type = 'adjustment' and supplier_id = old.supplier_id and debit = v_amount
    ) then
      insert into public.account_transactions (station_id, account_type, supplier_id, transaction_type, debit, business_date, reference_id, created_by, notes)
      values (old.station_id, 'supplier', old.supplier_id, 'adjustment', v_amount, new.business_date, old.id, new.created_by, 'عكس مديونية توريد ملغى');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sales_customer_account_void on public.sales;
create trigger trg_sales_customer_account_void after update of status on public.sales for each row execute function public.fn_reverse_customer_sale_account_on_void();
drop trigger if exists trg_deliveries_supplier_account_void on public.deliveries;
create trigger trg_deliveries_supplier_account_void after update of status on public.deliveries for each row execute function public.fn_reverse_supplier_delivery_account_on_void();
