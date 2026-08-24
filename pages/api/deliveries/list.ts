import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: any, res: any) {
  try {
    const stationId = String(req.query.stationId || '').trim();
    if (!stationId) return res.status(400).json({ error: 'stationId is required' });
    await requireStationOperator(req, stationId);
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from('v_deliveries').select('*').eq('station_id', stationId).order('business_date', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deliveries: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
