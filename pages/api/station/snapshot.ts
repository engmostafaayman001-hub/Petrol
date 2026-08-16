import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const stationId = (req.query.stationId as string | undefined)?.trim();
    const date = (req.query.date as string) || undefined;
    if (!stationId) return res.status(400).json({ error: 'stationId is required' });
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(stationId)) {
      return res.status(400).json({ error: 'Invalid stationId' });
    }

    const supabase = getServiceSupabase();
    const rpcDate = date || new Date().toISOString().slice(0, 10);
    const rpcArgs: any = { p_station_id: stationId, p_date: rpcDate };

    const { data, error } = await supabase.rpc('fn_station_snapshot', rpcArgs);
    if (error) {
      // log full error on server for debugging
      // eslint-disable-next-line no-console
      console.error('fn_station_snapshot RPC error:', error);
      // include useful fields in JSON response during development
      const payload: any = { message: error.message ?? 'rpc error' };
      if (error.details) payload.details = error.details;
      if (error.hint) payload.hint = error.hint;
      // Map common permission message to 403
      if (String(error.message).toLowerCase().includes('access')) {
        if (process.env.NODE_ENV !== 'production') {
          return res.status(200).json({ snapshot: null, warning: payload });
        }

        return res.status(403).json({ error: payload });
      }

      return res.status(500).json({ error: payload });
    }

    const snapshot = (data && typeof data === 'object') ? data : {} as any;
    const [tankResult, salesResult, deliveryResult, allSalesResult, allDeliveryResult, trendResult] = await Promise.all([
      supabase
        .from('v_tank_status')
        .select('system_quantity')
        .eq('station_id', stationId)
        .eq('is_active', true),
      supabase
        .from('sales')
        .select('gross_amount, unit_price, quantity')
        .eq('station_id', stationId)
        .eq('business_date', rpcDate),
      supabase
        .from('deliveries')
        .select('quantity, unit_cost')
        .eq('station_id', stationId)
        .eq('business_date', rpcDate),
      supabase.from('sales').select('gross_amount, unit_price, quantity').eq('station_id', stationId).eq('status', 'active'),
      supabase.from('deliveries').select('quantity, unit_cost').eq('station_id', stationId).eq('status', 'active'),
      supabase.rpc('fn_variance_trend', { p_station_id: stationId, p_days: 7 }),
    ]);

    const tankTotal = (tankResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row?.system_quantity ?? 0), 0);
    const collected = (salesResult.data ?? []).reduce((sum: number, row: any) => {
      const gross = Number(row?.gross_amount ?? ((Number(row?.unit_price ?? 0) * Number(row?.quantity ?? 0)) || 0));
      return sum + (Number.isFinite(gross) ? gross : 0);
    }, 0);
    const cost = (deliveryResult.data ?? []).reduce((sum: number, row: any) => {
      const totalCost = Number((Number(row?.unit_cost ?? 0) * Number(row?.quantity ?? 0)) || 0);
      return sum + (Number.isFinite(totalCost) ? totalCost : 0);
    }, 0);
    const totalCollected = (allSalesResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row?.gross_amount ?? (Number(row?.unit_price ?? 0) * Number(row?.quantity ?? 0))), 0);
    const totalCost = (allDeliveryResult.data ?? []).reduce((sum: number, row: any) => sum + (Number(row?.unit_cost ?? 0) * Number(row?.quantity ?? 0)), 0);

    const mergedSnapshot = {
      ...snapshot,
      stock: {
        ...(snapshot.stock ?? {}),
        total_system: paymentNumber(snapshot.stock?.total_system ?? tankTotal),
        total_available: paymentNumber(snapshot.stock?.total_available ?? tankTotal),
        total_capacity: paymentNumber(snapshot.stock?.total_capacity ?? 0),
      },
      today: {
        ...(snapshot.today ?? {}),
        sold: paymentNumber(snapshot.today?.sold ?? 0),
        delivered: paymentNumber(snapshot.today?.delivered ?? 0),
        delivery_count: Number(snapshot.today?.delivery_count ?? 0),
        sale_count: Number(snapshot.today?.sale_count ?? 0),
        total_collected: paymentNumber(snapshot.today?.total_collected ?? collected),
        total_cost: paymentNumber(snapshot.today?.total_cost ?? cost),
        total_profit: paymentNumber(snapshot.today?.total_profit ?? (collected - cost)),
      },
      totals: {
        total_collected: paymentNumber(totalCollected),
        total_cost: paymentNumber(totalCost),
        total_profit: paymentNumber(totalCollected - totalCost),
      },
      trend: Array.isArray(trendResult.data) ? trendResult.data : [],
    };

    return res.status(200).json({ snapshot: mergedSnapshot });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

function paymentNumber(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}
