-- Variance is a reconciliation result, not a second sale or automatic fuel deduction.
-- Keep the function for controlled server-side maintenance, but do not expose it
-- as a client-callable RPC.
revoke execute on function public.fn_post_reconciliation_variance(uuid, uuid) from authenticated;
