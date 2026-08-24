import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationManager } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { session_id, approved, reviewer_id } = req.body;
    if (!session_id || typeof approved === 'undefined') return res.status(400).json({ error: 'session_id and approved required' });
    const supabase = getServiceSupabase();
    const { data: session, error: sessionError } = await supabase.from('reconciliation_sessions').select('station_id').eq('id', session_id).maybeSingle();
    if (sessionError) return res.status(500).json({ error: sessionError.message });
    if (!session) return res.status(404).json({ error: 'جلسة التسوية غير موجودة.' });
    const actor = await requireStationManager(req, session.station_id);
    const { data, error } = await supabase.rpc('fn_review_reconciliation', { p_reconciliation_session_id: session_id, p_approved: approved, p_reviewer_id: actor.id });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
