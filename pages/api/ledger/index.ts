import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: any, res: any) {
  try {
    const stationId = String(req.query.stationId || '').trim();
    if (!stationId) return res.status(400).json({ error: 'stationId is required' });
    await requireStationOperator(req, stationId);
    const supabase = getServiceSupabase();
    const [{ data, error }, { data: expenses, error: expensesError }] = await Promise.all([
      supabase.from('v_ledger_feed').select('*').eq('station_id', stationId).order('occurred_at', { ascending: false }).limit(300),
      supabase.from('expenses').select('id,session_id,business_date,category,description,amount,status,created_at').eq('station_id', stationId).order('created_at', { ascending: false }).limit(300),
    ]);
    if (error) return res.status(500).json({ error: error.message });
    if (expensesError) return res.status(500).json({ error: expensesError.message });
    return res.status(200).json({ rows: data, expenses: expenses || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
