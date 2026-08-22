import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: any, res: any) {
  try {
    const stationId = String(req.query.stationId || '').trim();
    if (!stationId) return res.status(400).json({ error: 'stationId is required' });
    const supabase = getServiceSupabase();
    const [salesResult, deductionsResult, meterSalesResult] = await Promise.all([
      supabase.from('v_sales').select('*').eq('station_id', stationId).eq('status', 'active').order('business_date', { ascending: false }).limit(200),
      supabase.from('v_ledger_feed').select('id,business_date,tank_code,fuel_name,quantity_delta,shift_code,shift_name,note,occurred_at').eq('station_id', stationId).eq('txn_type', 'variance_writeoff').order('business_date', { ascending: false }).order('occurred_at', { ascending: false }).limit(200),
      supabase.from('v_reconciliation_lines_current').select('id,business_date,tank_code,fuel_name,shift_code,shift_name,opening_meter,closing_meter,meter_sold_qty,sold_qty,variance_qty,session_status').eq('station_id', stationId).not('meter_sold_qty', 'is', null).order('business_date', { ascending: false }).order('computed_at', { ascending: false }).limit(200),
    ]);
    if (salesResult.error || deductionsResult.error || meterSalesResult.error) return res.status(500).json({ error: salesResult.error?.message || deductionsResult.error?.message || meterSalesResult.error?.message });
    return res.status(200).json({ sales: salesResult.data || [], meterDeductions: deductionsResult.data || [], meterSales: meterSalesResult.data || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
