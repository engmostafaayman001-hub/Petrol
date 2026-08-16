import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const sessionId = (req.query.sessionId as string) || req.body.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const supabase = getServiceSupabase();
    const { data: sessions, error: se } = await supabase.from('v_reconciliation_sessions').select('*').eq('id', sessionId).limit(1).single();
    if (se) return res.status(500).json({ error: se.message });

    const { data: lines, error: le } = await supabase.from('v_reconciliation_lines').select('*').eq('session_id', sessionId).order('tank_code', { ascending: true });
    if (le) return res.status(500).json({ error: le.message });

    const { data: sales, error: salesError } = await supabase.from('v_sales').select('fuel_type_id,fuel_name,quantity,gross_amount').eq('station_id', sessions.station_id).eq('business_date', sessions.business_date).eq('shift_id', sessions.shift_id).eq('status', 'active');
    if (salesError) return res.status(500).json({ error: salesError.message });
    const cashByFuel = Object.values((sales || []).reduce((groups: Record<string, any>, sale: any) => {
      const current = groups[sale.fuel_type_id] || { fuel_type_id: sale.fuel_type_id, fuel_name: sale.fuel_name, quantity: 0, collected: 0 };
      current.quantity += Number(sale.quantity || 0); current.collected += Number(sale.gross_amount || 0); groups[sale.fuel_type_id] = current; return groups;
    }, {}));
    const totalCollected = (cashByFuel as any[]).reduce((total, row) => total + row.collected, 0);

    return res.status(200).json({ session: { ...sessions, total_collected: totalCollected }, lines, cashByFuel });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
