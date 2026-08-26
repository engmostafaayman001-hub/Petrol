-- Keep compatibility with remote reconciliation functions that order sessions by created_at.
alter table public.reconciliation_sessions
  add column if not exists created_at timestamptz not null default now();

create index if not exists recon_sessions_created_at_idx
  on public.reconciliation_sessions (station_id, created_at desc);
