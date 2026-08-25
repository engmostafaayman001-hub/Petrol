-- Preserve all operational fields when a manager replaces an open-session record.
create or replace function public.fn_manager_replace_sale(p_sale_id uuid, p_payload jsonb, p_reason text, p_actor uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare old_sale public.sales%rowtype; session_status public.reconciliation_status; new_id uuid; actor uuid := auth.uid();
begin
  if not public.app_is_manager() then raise exception 'هذا الإجراء متاح للمدير فقط.' using errcode = 'insufficient_privilege'; end if;
  select * into old_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'المبيعة غير موجودة.' using errcode = 'no_data_found'; end if;
  if old_sale.status <> 'active' then raise exception 'لا يمكن تعديل مبيعة ملغاة.' using errcode = 'restrict_violation'; end if;
  select status into session_status from public.reconciliation_sessions where id = old_sale.session_id;
  if session_status <> 'open' then raise exception 'لا يمكن تعديل مبيعة مرتبطة بجلسة مغلقة.' using errcode = 'restrict_violation'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'سبب التعديل مطلوب.' using errcode = 'check_violation'; end if;
  update public.sales set status = 'voided', void_reason = 'استبدال إداري: ' || p_reason, voided_by = actor, voided_at = now() where id = p_sale_id;
  insert into public.sales (station_id,tank_id,fuel_type_id,business_date,shift_id,session_id,quantity,unit_price,customer_id,paid_amount,driver_name,vehicle_number,payment_method,sales_channel,pump_label,nozzle_label,meter_open,meter_close,notes,created_by,status)
  values (old_sale.station_id,coalesce((p_payload->>'tank_id')::uuid,old_sale.tank_id),coalesce((p_payload->>'fuel_type_id')::uuid,old_sale.fuel_type_id),coalesce((p_payload->>'business_date')::date,old_sale.business_date),old_sale.shift_id,old_sale.session_id,coalesce((p_payload->>'quantity')::numeric,old_sale.quantity),coalesce((p_payload->>'unit_price')::numeric,old_sale.unit_price),coalesce((p_payload->>'customer_id')::uuid,old_sale.customer_id),coalesce((p_payload->>'paid_amount')::numeric,old_sale.paid_amount),coalesce(p_payload->>'driver_name',old_sale.driver_name),coalesce(p_payload->>'vehicle_number',old_sale.vehicle_number),coalesce(p_payload->>'payment_method',old_sale.payment_method),coalesce(p_payload->>'sales_channel',old_sale.sales_channel),coalesce(p_payload->>'pump_label',old_sale.pump_label),coalesce(p_payload->>'nozzle_label',old_sale.nozzle_label),old_sale.meter_open,old_sale.meter_close,coalesce(p_payload->>'notes',old_sale.notes),actor,'active') returning id into new_id;
  return new_id;
end; $$;

create or replace function public.fn_manager_replace_delivery(p_delivery_id uuid, p_payload jsonb, p_reason text, p_actor uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare old_delivery public.deliveries%rowtype; session_status public.reconciliation_status; new_id uuid; actor uuid := auth.uid();
begin
  if not public.app_is_manager() then raise exception 'هذا الإجراء متاح للمدير فقط.' using errcode = 'insufficient_privilege'; end if;
  select * into old_delivery from public.deliveries where id = p_delivery_id for update;
  if not found then raise exception 'التوريد غير موجود.' using errcode = 'no_data_found'; end if;
  if old_delivery.status <> 'active' then raise exception 'لا يمكن تعديل توريد ملغى.' using errcode = 'restrict_violation'; end if;
  select status into session_status from public.reconciliation_sessions where id = old_delivery.session_id;
  if session_status <> 'open' then raise exception 'لا يمكن تعديل توريد مرتبط بجلسة مغلقة.' using errcode = 'restrict_violation'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'سبب التعديل مطلوب.' using errcode = 'check_violation'; end if;
  update public.deliveries set status = 'voided', void_reason = 'استبدال إداري: ' || p_reason, voided_by = actor, voided_at = now() where id = p_delivery_id;
  insert into public.deliveries (station_id,tank_id,fuel_type_id,business_date,shift_id,session_id,supplier_id,quantity,unit_cost,tanker_ref,driver_name,reference_no,meter_before,meter_after,notes,created_by,status)
  values (old_delivery.station_id,coalesce((p_payload->>'tank_id')::uuid,old_delivery.tank_id),coalesce((p_payload->>'fuel_type_id')::uuid,old_delivery.fuel_type_id),coalesce((p_payload->>'business_date')::date,old_delivery.business_date),old_delivery.shift_id,old_delivery.session_id,coalesce((p_payload->>'supplier_id')::uuid,old_delivery.supplier_id),coalesce((p_payload->>'quantity')::numeric,old_delivery.quantity),coalesce((p_payload->>'unit_cost')::numeric,old_delivery.unit_cost),coalesce(p_payload->>'tanker_ref',old_delivery.tanker_ref),coalesce(p_payload->>'driver_name',old_delivery.driver_name),coalesce(p_payload->>'reference_no',old_delivery.reference_no),old_delivery.meter_before,old_delivery.meter_after,coalesce(p_payload->>'notes',old_delivery.notes),actor,'active') returning id into new_id;
  return new_id;
end; $$;
