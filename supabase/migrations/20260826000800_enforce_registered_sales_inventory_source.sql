-- Inventory is reduced by registered sales exactly once.
-- Meter readings and settlement differences are reporting data only; they must
-- never create a second inventory movement.
create or replace function public.fn_post_reconciliation_variance(
  p_session_id uuid,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'خصم المخزون يتم من المبيعات المسجلة فقط، وفرق العداد للتسوية دون خصم إضافي.'
    using errcode = 'feature_not_supported';
end;
$$;

revoke execute on function public.fn_post_reconciliation_variance(uuid, uuid) from anon, authenticated;

comment on function public.fn_post_reconciliation_variance(uuid, uuid) is
  'Disabled by design: registered sales are the only sale inventory movements; meter variance is reconciliation-only.';
