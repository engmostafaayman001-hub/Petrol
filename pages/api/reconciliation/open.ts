import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { station_id, business_date, shift_id } = req.body;
    if (!station_id || !business_date) return res.status(400).json({ error: 'station_id and business_date required' });
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.rpc('fn_open_reconciliation', { p_station_id: station_id, p_business_date: business_date, p_shift_id: shift_id });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
