import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const stationId = (req.query.stationId as string) || req.body.stationId;
    if (!stationId) return res.status(400).json({ error: 'stationId is required' });

    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from('v_reconciliation_sessions').select('*').eq('station_id', stationId).order('business_date', { ascending: false }).order('shift_seq', { ascending: false }).limit(100);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ sessions: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
