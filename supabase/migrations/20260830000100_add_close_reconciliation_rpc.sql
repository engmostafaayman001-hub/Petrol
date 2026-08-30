-- Add close reconciliation RPC function
-- Migration: 20260830000100_add_close_reconciliation_rpc

-- Create RPC function for closing reconciliation sessions
CREATE OR REPLACE FUNCTION public.fn_close_reconciliation(
  p_session_id uuid,
  p_operator_id uuid,
  p_notes text default null
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_result json;
BEGIN
  -- Fetch session
  SELECT * INTO v_session
  FROM public.reconciliation_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'جلسة التسوية غير موجودة.';
  END IF;

  IF v_session.status != 'open' THEN
    RAISE EXCEPTION 'هذه الجلسة مغلقة بالفعل.';
  END IF;

  -- Update session status to closed
  UPDATE public.reconciliation_sessions
  SET
    status = 'closed',
    closed_at = now(),
    closed_by = p_operator_id,
    notes = COALESCE(p_notes, notes)
  WHERE id = p_session_id
  RETURNING row_to_json(reconciliation_sessions.*) INTO v_result;

  -- Log the event
  INSERT INTO public.audit_trail (
    entity_type,
    entity_id,
    action,
    actor_id,
    changes,
    created_at
  ) VALUES (
    'reconciliation_sessions',
    p_session_id,
    'close',
    p_operator_id,
    json_build_object(
      'status', 'open -> closed',
      'closed_at', now(),
      'closed_by', p_operator_id
    ),
    now()
  );

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION '%', SQLERRM;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.fn_close_reconciliation TO authenticated;
