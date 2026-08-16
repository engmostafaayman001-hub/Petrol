import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: any, res: any) {
  try {
    const stationId = String(req.query.stationId || '').trim();
    if (!stationId) return res.status(400).json({ error: 'stationId is required' });
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from('v_ledger_feed').select('*').eq('station_id', stationId).order('occurred_at', { ascending: false }).limit(300);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ rows: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
