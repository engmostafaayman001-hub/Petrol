-- Reconciliation dates represent the station's Egyptian operating day, not
-- the UTC calendar day.  The opening function uses current_date internally;
-- pin its execution timezone so the date remains correct around midnight.
alter function public.fn_open_reconciliation(uuid, uuid, jsonb, jsonb, uuid)
  set timezone to 'Africa/Cairo';
