import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { session_id } = req.body || {};
    if (!session_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(session_id))) return res.status(400).json({ error: 'معرّف جلسة التسوية غير صالح.' });
    const supabase = getServiceSupabase();
    const { data: session, error: sessionError } = await supabase.from('reconciliation_sessions').select('status').eq('id', session_id).maybeSingle();
    if (sessionError) return res.status(400).json({ error: sessionError.message });
    if (!session) return res.status(404).json({ error: 'جلسة التسوية غير موجودة.' });
    if (session.status !== 'open') return res.status(409).json({ error: 'هذه الجلسة مغلقة بالفعل.' });
    const { data, error } = await supabase.rpc('fn_submit_reconciliation', { p_session_id: session_id, p_notes: null });
    if (error) return res.status(400).json({ error: error.message, details: error.details ?? null, hint: error.hint ?? null });
    return res.status(200).json({ result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
