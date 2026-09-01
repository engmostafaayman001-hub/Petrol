-- ---------------------------------------------------------------------------
-- Compatibility repair for databases created before `tank_transfer` was
-- included in public.txn_type. The operation is idempotent and does not alter
-- inventory balances or historical transactions.
--
-- The enum value is committed in this migration before any subsequent function
-- change uses it.
-- ---------------------------------------------------------------------------

alter type public.txn_type add value if not exists 'tank_transfer';
