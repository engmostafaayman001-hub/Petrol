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
    const deliveries = (data || []).map((delivery: any) => {
      const totalCost = Math.round((Number(delivery.quantity || 0) * Number(delivery.unit_cost || 0) + Number.EPSILON) * 100) / 100;
      const paidAmount = Math.max(Number(delivery.paid_amount || 0), 0);
      return { ...delivery, total_cost: totalCost, paid_amount: paidAmount, remaining: Math.max(totalCost - paidAmount, 0) };
    });
    return res.status(200).json({ deliveries });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
