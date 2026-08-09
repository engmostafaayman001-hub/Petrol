import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const sessionId = (req.query.sessionId as string) || req.body.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const supabase = getServiceSupabase();
    const { data: sessions, error: se } = await supabase.from('v_reconciliation_sessions').select('*').eq('id', sessionId).limit(1).single();
    if (se) return res.status(500).json({ error: se.message });

    const { data: lines, error: le } = await supabase.from('v_reconciliation_lines').select('*').eq('reconciliation_session_id', sessionId).order('tank_code', { ascending: true });
    if (le) return res.status(500).json({ error: le.message });

    return res.status(200).json({ session: sessions, lines });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
