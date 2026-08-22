import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const sessionId = (req.query.sessionId as string) || req.body.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const supabase = getServiceSupabase();
    const { data: sessions, error: se } = await supabase.from('v_reconciliation_sessions').select('*').eq('id', sessionId).limit(1).single();
    if (se) return res.status(500).json({ error: se.message });
    if (!sessions) return res.status(404).json({ error: 'جلسة التسوية غير موجودة.' });
    try { await requireStationOperator(req, sessions.station_id); } catch (error: any) { return res.status(401).json({ error: error.message }); }

    const { data: lines, error: le } = await supabase.from('v_reconciliation_lines_current').select('*').eq('session_id', sessionId).order('tank_code', { ascending: true });
    if (le) return res.status(500).json({ error: le.message });

    const { data: sales, error: salesError } = await supabase.from('v_sales').select('fuel_type_id,fuel_name,quantity,gross_amount').eq('station_id', sessions.station_id).eq('business_date', sessions.business_date).eq('shift_id', sessions.shift_id).eq('status', 'active');
    if (salesError) return res.status(500).json({ error: salesError.message });
    const { data: services, error: servicesError } = await supabase.from('service_sales').select('id,service_type,service_name,vehicle_type,amount,created_at,created_by').eq('station_id', sessions.station_id).eq('session_id', sessions.id).eq('status', 'active').order('created_at', { ascending: false });
    if (servicesError && !String(servicesError.message).toLowerCase().includes('does not exist')) return res.status(500).json({ error: servicesError.message });
    const cashByFuel = Object.values((sales || []).reduce((groups: Record<string, any>, sale: any) => {
      const current = groups[sale.fuel_type_id] || { fuel_type_id: sale.fuel_type_id, fuel_name: sale.fuel_name, quantity: 0, collected: 0 };
      current.quantity += Number(sale.quantity || 0); current.collected += Number(sale.gross_amount || 0); groups[sale.fuel_type_id] = current; return groups;
    }, {}));
    const totalCollected = (cashByFuel as any[]).reduce((total, row) => total + row.collected, 0);
    const serviceTotal = (services || []).reduce((total: number, service: any) => total + Number(service.amount || 0), 0);

    return res.status(200).json({ session: { ...sessions, total_collected: totalCollected + serviceTotal, total_service_sales: serviceTotal }, lines, cashByFuel, services: services || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
