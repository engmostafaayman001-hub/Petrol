-- Fix reset RPCs already deployed before the reconciliation-line cascade guard
-- was accounted for. The trigger is disabled only around the cascade delete.
create or replace function public.fn_reset_operational_data(
  p_station_id uuid, p_actor_id uuid, p_confirmation text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text;
begin
  select code into v_code from public.stations where id = p_station_id;
  if v_code is null then raise exception 'المحطة غير موجودة.' using errcode = 'no_data_found'; end if;
  if p_confirmation is distinct from v_code then raise exception 'تأكيد المحطة غير صحيح.' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.profiles where id = p_actor_id and station_id = p_station_id and role = 'manager' and is_active) then
    raise exception 'تحتاج صلاحية مدير لتنفيذ حذف بيانات التشغيل.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.reconciliation_sessions where station_id = p_station_id and status = 'open') then
    raise exception 'أغلق الوردية المفتوحة قبل حذف بيانات التشغيل.' using errcode = 'restrict_violation';
  end if;
  alter table public.sales disable trigger trg_sales_guard;
  alter table public.deliveries disable trigger trg_deliveries_guard;
  update public.sales set session_id = null where station_id = p_station_id;
  update public.deliveries set session_id = null where station_id = p_station_id;
  alter table public.sales enable trigger trg_sales_guard;
  alter table public.deliveries enable trigger trg_deliveries_guard;
  delete from public.notification_reads where notification_id in (select id from public.notifications where station_id = p_station_id);
  delete from public.notifications where station_id = p_station_id;
  delete from public.expenses where station_id = p_station_id;
  delete from public.service_sales where station_id = p_station_id;
  delete from public.adjustments where station_id = p_station_id;
  alter table public.reconciliation_lines disable trigger trg_recon_lines_no_delete;
  delete from public.reconciliation_sessions where station_id = p_station_id;
  alter table public.reconciliation_lines enable trigger trg_recon_lines_no_delete;
  update public.sales set status = 'voided', voided_by = p_actor_id, voided_at = now(), void_reason = 'إعادة تهيئة بيانات التشغيل بطلب المدير' where station_id = p_station_id and status = 'active';
  update public.deliveries set status = 'voided', voided_by = p_actor_id, voided_at = now(), void_reason = 'إعادة تهيئة بيانات التشغيل بطلب المدير' where station_id = p_station_id and status = 'active';
  insert into public.audit_logs (station_id, actor_id, actor_role, action, entity, entity_label, reason) values (p_station_id, p_actor_id, 'manager', 'delete', 'operational_data_reset', v_code, 'تم مسح بيانات التشغيل مع إبقاء إعدادات المحطة والحسابات.');
end;
$$;

create or replace function public.fn_reset_session_data(
  p_station_id uuid, p_actor_id uuid, p_confirmation text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text;
begin
  select code into v_code from public.stations where id = p_station_id;
  if v_code is null then raise exception 'المحطة غير موجودة.' using errcode = 'no_data_found'; end if;
  if p_confirmation is distinct from v_code then raise exception 'تأكيد المحطة غير صحيح.' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.profiles where id = p_actor_id and station_id = p_station_id and role = 'manager' and is_active) then
    raise exception 'تحتاج صلاحية مدير لتنفيذ حذف بيانات الجلسات.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.reconciliation_sessions where station_id = p_station_id and status = 'open') then
    raise exception 'أغلق الوردية المفتوحة قبل حذف بيانات الجلسات.' using errcode = 'restrict_violation';
  end if;
  alter table public.sales disable trigger trg_sales_guard;
  alter table public.deliveries disable trigger trg_deliveries_guard;
  update public.sales set session_id = null where station_id = p_station_id;
  update public.deliveries set session_id = null where station_id = p_station_id;
  alter table public.sales enable trigger trg_sales_guard;
  alter table public.deliveries enable trigger trg_deliveries_guard;
  delete from public.notification_reads where notification_id in (select id from public.notifications where station_id = p_station_id);
  delete from public.notifications where station_id = p_station_id;
  delete from public.expenses where station_id = p_station_id;
  delete from public.service_sales where station_id = p_station_id;
  delete from public.adjustments where station_id = p_station_id;
  alter table public.reconciliation_lines disable trigger trg_recon_lines_no_delete;
  delete from public.reconciliation_sessions where station_id = p_station_id;
  alter table public.reconciliation_lines enable trigger trg_recon_lines_no_delete;
  insert into public.audit_logs (station_id, actor_id, actor_role, action, entity, entity_label, reason) values (p_station_id, p_actor_id, 'manager', 'delete', 'session_data_reset', v_code, 'تم مسح الجلسات والبيانات غير الأساسية مع إبقاء العمليات المالية.');
end;
$$;

grant execute on function public.fn_reset_operational_data(uuid, uuid, text) to authenticated;
grant execute on function public.fn_reset_session_data(uuid, uuid, text) to authenticated;