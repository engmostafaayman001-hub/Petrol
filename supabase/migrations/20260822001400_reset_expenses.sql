-- Expenses are operational records and follow the existing manager reset workflow.
create or replace function public.fn_reset_operational_data(
  p_station_id uuid,
  p_actor_id uuid,
  p_confirmation text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_open boolean;
begin
  select s.code into v_code from public.stations s where s.id = p_station_id;
  if v_code is null then raise exception 'المحطة غير موجودة.' using errcode = 'no_data_found'; end if;
  if p_confirmation is distinct from v_code then raise exception 'تأكيد المحطة غير صحيح.' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.profiles where id = p_actor_id and station_id = p_station_id and role = 'manager' and is_active) then
    raise exception 'تحتاج صلاحية مدير لتنفيذ حذف بيانات التشغيل.' using errcode = 'insufficient_privilege';
  end if;
  select exists (select 1 from public.reconciliation_sessions where station_id = p_station_id and status = 'open') into v_open;
  if v_open then raise exception 'أغلق الوردية المفتوحة قبل حذف بيانات التشغيل.' using errcode = 'restrict_violation'; end if;

  perform set_config('app.operational_reset', 'on', true);
  delete from public.notification_reads where notification_id in (select id from public.notifications where station_id = p_station_id);
  delete from public.notifications where station_id = p_station_id;
  delete from public.expenses where station_id = p_station_id;
  delete from public.service_sales where station_id = p_station_id;
  delete from public.adjustments where station_id = p_station_id;
  delete from public.reconciliation_sessions where station_id = p_station_id;
  update public.sales set status = 'voided', voided_by = p_actor_id, voided_at = now(), void_reason = 'إعادة تهيئة بيانات التشغيل بطلب المدير' where station_id = p_station_id and status = 'active';
  update public.deliveries set status = 'voided', voided_by = p_actor_id, voided_at = now(), void_reason = 'إعادة تهيئة بيانات التشغيل بطلب المدير' where station_id = p_station_id and status = 'active';
  insert into public.audit_logs (station_id, actor_id, actor_role, action, entity, entity_label, reason)
  select p_station_id, p_actor_id, 'manager', 'delete', 'operational_data_reset', v_code, 'تم حذف بيانات التشغيل مع إبقاء إعدادات المحطة وسجل التدقيق.';
end;
$$;

grant execute on function public.fn_reset_operational_data(uuid, uuid, text) to authenticated;
