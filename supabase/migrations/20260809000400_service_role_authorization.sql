-- ---------------------------------------------------------------------------
-- Service-role authorization bypass for trusted backend RPCs
-- ---------------------------------------------------------------------------
-- The API server calls Postgres via the Supabase service role. Those calls do
-- not carry a user JWT with auth.uid() set, so database guards that compare
-- against the caller's profile incorrectly reject valid backend operations.
-- Trusted service-role calls must bypass the station-member checks while all
-- standard user-session checks remain unchanged.

create or replace function public.app_is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_jwt_role() = 'service_role'
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active
    );
$$;

create or replace function public.app_station_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.app_jwt_role() = 'service_role' then null
    else (
      select p.station_id
      from public.profiles p
      where p.id = auth.uid() and p.is_active
    )
  end;
$$;

create or replace function public.app_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.app_jwt_role() = 'service_role' then 'manager'
    else (
      select p.role
      from public.profiles p
      where p.id = auth.uid() and p.is_active
    )
  end;
$$;

create or replace function public.app_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_jwt_role() = 'service_role'
    or coalesce((
      select p.role = 'manager'
      from public.profiles p
      where p.id = auth.uid() and p.is_active
    ), false);
$$;

create or replace function public.app_owns(p_station_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_jwt_role() = 'service_role'
    or (
      p_station_id is not distinct from public.app_station_id()
      and public.app_is_active_member()
    );
$$;
