import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: any, res: any) {
  try {
    const stationId = String(req.query.stationId || '').trim();
    if (!stationId) return res.status(400).json({ error: 'stationId is required' });
    await requireStationOperator(req, stationId);
    const supabase = getServiceSupabase();
    const { data: currentSession, error: sessionError } = await supabase.from('reconciliation_sessions').select('id,business_date,shift_id,shift_seq,status').eq('station_id', stationId).eq('status', 'open').order('opened_at', { ascending: false }).maybeSingle();
    if (sessionError) return res.status(500).json({ error: sessionError.message });
    const [salesResult, deductionsResult, meterSalesResult] = await Promise.all([
      currentSession ? supabase.from('v_sales').select('*').eq('station_id', stationId).eq('shift_id', currentSession.shift_id).eq('business_date', currentSession.business_date).eq('status', 'active').order('created_at', { ascending: false }).limit(200) : Promise.resolve({ data: [], error: null }),
      supabase.from('v_ledger_feed').select('id,business_date,tank_code,fuel_name,quantity_delta,shift_code,shift_name,note,occurred_at').eq('station_id', stationId).eq('txn_type', 'variance_writeoff').order('business_date', { ascending: false }).order('occurred_at', { ascending: false }).limit(200),
      currentSession ? supabase.from('v_reconciliation_lines_current').select('id,business_date,tank_code,fuel_name,shift_code,shift_name,opening_meter,closing_meter,meter_sold_qty,sold_qty,variance_qty,session_status').eq('session_id', currentSession.id).not('meter_sold_qty', 'is', null).order('computed_at', { ascending: false }).limit(200) : Promise.resolve({ data: [], error: null }),
    ]);
    if (salesResult.error || deductionsResult.error || meterSalesResult.error) return res.status(500).json({ error: salesResult.error?.message || deductionsResult.error?.message || meterSalesResult.error?.message });
    const sales = salesResult.data || [];
    const saleIds = sales.map((sale: any) => sale.id).filter(Boolean);
    const { data: saleDetails, error: saleDetailsError } = saleIds.length
      ? await supabase.from('sales').select('id,customer_id,gross_amount,paid_amount,driver_name,vehicle_number').in('id', saleIds)
      : { data: [], error: null };
    if (saleDetailsError) return res.status(500).json({ error: saleDetailsError.message });
    const saleDetailsById = new Map((saleDetails || []).map((sale: any) => [sale.id, sale]));
    const enrichedSales = sales.map((sale: any) => ({ ...sale, ...(saleDetailsById.get(sale.id) || {}) }));
    const customerIds = Array.from(new Set(enrichedSales.map((sale: any) => sale.customer_id).filter(Boolean)));
    const { data: customers, error: customersError } = customerIds.length
      ? await supabase.from('customers').select('id,name').in('id', customerIds)
      : { data: [], error: null };
    if (customersError) return res.status(500).json({ error: customersError.message });
    const customerNames = new Map((customers || []).map((customer: any) => [customer.id, customer.name]));
    return res.status(200).json({ session: currentSession || null, sales: enrichedSales.map((sale: any) => ({ ...sale, customer_name: customerNames.get(sale.customer_id) || null })), meterDeductions: deductionsResult.data || [], meterSales: meterSalesResult.data || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
