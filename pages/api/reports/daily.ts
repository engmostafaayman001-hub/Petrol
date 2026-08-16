import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const stationId = String(req.query.stationId || '').trim();
    const from = String(req.query.from || req.query.date || '').slice(0, 10);
    const to = String(req.query.to || from).slice(0, 10);
    if (!stationId || !from || !to || from > to) return res.status(400).json({ error: 'stationId and a valid date range are required' });
    const supabase = getServiceSupabase();
    const [movementResult, salesResult, deliveryResult] = await Promise.all([
      supabase.from('v_daily_fuel_movement').select('*').eq('station_id', stationId).gte('business_date', from).lte('business_date', to).order('fuel_code'),
      supabase.from('v_sales').select('fuel_type_id,fuel_name,gross_amount,quantity,unit_price').eq('station_id', stationId).eq('status', 'active').gte('business_date', from).lte('business_date', to),
      supabase.from('v_deliveries').select('fuel_type_id,fuel_name,total_cost,unit_cost,quantity').eq('station_id', stationId).eq('status', 'active').gte('business_date', from).lte('business_date', to),
    ]);
    if (movementResult.error || salesResult.error || deliveryResult.error) return res.status(500).json({ error: movementResult.error?.message || salesResult.error?.message || deliveryResult.error?.message });
    const groups = new Map<string, any>();
    for (const row of movementResult.data || []) {
      const key = row.fuel_type_id;
      const current = groups.get(key) || { fuel_type_id: key, fuel_code: row.fuel_code, fuel_name: row.fuel_name, delivered: 0, sold: 0, variance: 0, adjusted: 0, movement_count: 0 };
      for (const field of ['delivered', 'sold', 'variance', 'adjusted', 'movement_count']) current[field] += Number(row[field] || 0);
      groups.set(key, current);
    }
    for (const sale of salesResult.data || []) {
      const current = groups.get(sale.fuel_type_id) || { fuel_type_id: sale.fuel_type_id, fuel_name: sale.fuel_name, delivered: 0, sold: 0, variance: 0, adjusted: 0, movement_count: 0 };
      current.revenue = Number(current.revenue || 0) + Number(sale.gross_amount || 0); current.sales_quantity = Number(current.sales_quantity || 0) + Number(sale.quantity || 0); groups.set(sale.fuel_type_id, current);
    }
    for (const delivery of deliveryResult.data || []) {
      const current = groups.get(delivery.fuel_type_id) || { fuel_type_id: delivery.fuel_type_id, fuel_name: delivery.fuel_name, delivered: 0, sold: 0, variance: 0, adjusted: 0, movement_count: 0 };
      current.cost = Number(current.cost || 0) + Number(delivery.total_cost || 0); current.delivery_cost_quantity = Number(current.delivery_cost_quantity || 0) + Number(delivery.quantity || 0); groups.set(delivery.fuel_type_id, current);
    }
    const rows = [...groups.values()].map((row: any) => ({ ...row, revenue: Number(row.revenue || 0), cost: Number(row.cost || 0), profit: Number(row.revenue || 0) - Number(row.cost || 0), average_sale_price: row.sales_quantity ? Number(row.revenue || 0) / row.sales_quantity : 0, average_purchase_price: row.delivery_cost_quantity ? Number(row.cost || 0) / row.delivery_cost_quantity : 0, net_change: Number(row.delivered || 0) - Number(row.sold || 0) + Number(row.adjusted || 0) + Number(row.variance || 0) }));
    const totals = rows.reduce((total: any, row: any) => ({ collected: total.collected + row.revenue, cost: total.cost + row.cost, profit: total.profit + row.profit }), { collected: 0, cost: 0, profit: 0 });
    return res.status(200).json({ rows, totals });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}
