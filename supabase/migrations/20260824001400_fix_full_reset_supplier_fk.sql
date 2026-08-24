-- Fuel types reference suppliers, so remove fuel types before suppliers.
create or replace function public.fn_reset_all_application_data(
  p_station_id uuid, p_actor_id uuid, p_confirmation text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text;
begin
  select code into v_code from public.stations where id = p_station_id;
  if v_code is null then raise exception 'المحطة غير موجودة.' using errcode = 'no_data_found'; end if;
  if p_confirmation is distinct from v_code then raise exception 'تأكيد المحطة غير صحيح.' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.profiles where id = p_actor_id and station_id = p_station_id and role = 'manager' and is_active) then
    raise exception 'تحتاج صلاحية مدير لتنفيذ المسح الكامل.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.reconciliation_sessions where station_id = p_station_id and status = 'open') then
    raise exception 'أغلق الوردية المفتوحة قبل المسح الكامل.' using errcode = 'restrict_violation';
  end if;

  alter table public.sales disable trigger trg_sales_no_delete;
  alter table public.deliveries disable trigger trg_deliveries_no_delete;
  alter table public.reconciliation_lines disable trigger trg_recon_lines_no_delete;
  alter table public.inventory_transactions disable trigger trg_inventory_txn_immutable;
  alter table public.tank_readings disable trigger trg_tank_readings_immutable;
  alter table public.audit_logs disable trigger trg_audit_logs_immutable;

  delete from public.notification_reads where notification_id in (select id from public.notifications where station_id = p_station_id);
  delete from public.notifications where station_id = p_station_id;
  delete from public.account_transactions where station_id = p_station_id;
  delete from public.expenses where station_id = p_station_id;
  delete from public.service_sales where station_id = p_station_id;
  delete from public.adjustments where station_id = p_station_id;
  delete from public.sales where station_id = p_station_id;
  delete from public.deliveries where station_id = p_station_id;
  delete from public.reconciliation_sessions where station_id = p_station_id;
  delete from public.tank_readings where station_id = p_station_id;
  update public.inventory_transactions set reverses_txn_id = null where station_id = p_station_id;
  delete from public.inventory_transactions where station_id = p_station_id;
  delete from public.tank_balances where station_id = p_station_id;
  delete from public.pump_meters where station_id = p_station_id;
  delete from public.sensor_devices where station_id = p_station_id;
  delete from public.audit_logs where station_id = p_station_id;
  delete from public.fuel_price_history where station_id = p_station_id;
  delete from public.tanks where station_id = p_station_id;
  delete from public.fuel_types where station_id = p_station_id;
  delete from public.suppliers where station_id = p_station_id;
  delete from public.customers where station_id = p_station_id;

  alter table public.audit_logs enable trigger trg_audit_logs_immutable;
  alter table public.tank_readings enable trigger trg_tank_readings_immutable;
  alter table public.inventory_transactions enable trigger trg_inventory_txn_immutable;
  alter table public.reconciliation_lines enable trigger trg_recon_lines_no_delete;
  alter table public.deliveries enable trigger trg_deliveries_no_delete;
  alter table public.sales enable trigger trg_sales_no_delete;
end;
$$;

grant execute on function public.fn_reset_all_application_data(uuid, uuid, text) to authenticated;