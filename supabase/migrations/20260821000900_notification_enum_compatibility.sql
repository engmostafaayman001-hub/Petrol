-- Allow existing trigger calls that pass notification enum values as text.
-- PostgreSQL does not resolve unknown literals to the enum overload in every
-- trigger/function context, which can abort reconciliation writes.
create or replace function public.fn_raise_notification(
  p_station_id uuid,
  p_kind text,
  p_severity text,
  p_title text,
  p_body text,
  p_dedupe_key text,
  p_entity text default null,
  p_entity_id text default null,
  p_target text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fn_raise_notification(
    p_station_id,
    p_kind::public.notification_kind,
    p_severity::public.notification_severity,
    p_title,
    p_body,
    p_dedupe_key,
    p_entity,
    p_entity_id,
    p_target::public.user_role
  );
end;
$$;

grant execute on function public.fn_raise_notification(uuid, text, text, text, text, text, text, text, text) to authenticated;
