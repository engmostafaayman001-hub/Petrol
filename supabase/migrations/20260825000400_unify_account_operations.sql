-- Keep account movements in the same accounting period as operational rows.
alter table public.account_transactions
  add column if not exists session_id uuid references public.reconciliation_sessions(id) on delete restrict;
create index if not exists account_transactions_session_idx
  on public.account_transactions(session_id, created_at desc)
  where session_id is not null;

-- A fully paid customer sale has no receivable entry to post.
create or replace function public.fn_post_customer_sale_account()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_due numeric(16,2);
begin
  v_due := round(coalesce(new.gross_amount, 0) - coalesce(new.paid_amount, 0), 2);
  if new.status = 'active' and new.customer_id is not null and v_due > 0
     and (tg_op = 'INSERT' or old.status <> 'active' or old.customer_id is distinct from new.customer_id) then
    insert into public.account_transactions
      (station_id, account_type, customer_id, transaction_type, debit, business_date, session_id, reference_id, created_by, notes)
    values
      (new.station_id, 'customer', new.customer_id, 'sale', v_due, new.business_date, new.session_id, new.id, new.created_by, 'مبيعات آجلة');
  end if;
  return new;
end;
$$;

-- Account payments are period-bound by the API; this trigger protects direct
-- inserts used by trusted database jobs and fills an omitted session link.
create or replace function public.fn_attach_account_open_session()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_session public.reconciliation_sessions%rowtype;
begin
  if new.session_id is null then
    select * into v_session from public.reconciliation_sessions
     where station_id = new.station_id and business_date = new.business_date
       and status = 'open' order by opened_at desc limit 1;
    if found then new.session_id := v_session.id; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_account_transactions_attach_session on public.account_transactions;
create trigger trg_account_transactions_attach_session
  before insert on public.account_transactions
  for each row execute function public.fn_attach_account_open_session();