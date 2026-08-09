import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const date = (req.query.date as string) || req.body?.date;
    if (!date) return res.status(400).json({ error: 'date required' });
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from('v_daily_fuel_movement').select('*').eq('business_date', date).order('fuel_code', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ rows: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
