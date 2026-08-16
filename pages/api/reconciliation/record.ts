import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { session_id, tank_id, actual_closing_qty } = req.body;
    if (!session_id || !tank_id || typeof actual_closing_qty === 'undefined') return res.status(400).json({ error: 'session_id, tank_id and actual_closing_qty required' });
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.rpc('fn_record_closing_measurement', {
      p_session_id: session_id, p_tank_id: tank_id, p_quantity: actual_closing_qty,
      p_source: 'manual', p_sensor_device_id: null, p_notes: null, p_raw: null,
    });
    if (error) return res.status(400).json({ error: error.message, details: error.details ?? null, hint: error.hint ?? null });
    return res.status(200).json({ result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
