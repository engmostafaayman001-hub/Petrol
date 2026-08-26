-- Return session summaries in one database request for report pages.
create or replace function public.fn_session_sales_summaries(p_session_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('session_id', ids.session_id, 'summary', public.fn_session_sales_summary(ids.session_id)) order by ids.session_id), '[]'::jsonb)
  from unnest(coalesce(p_session_ids, '{}'::uuid[])) as ids(session_id);
$$;

grant execute on function public.fn_session_sales_summaries(uuid[]) to authenticated;
