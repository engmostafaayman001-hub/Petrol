import type { NextApiRequest, NextApiResponse } from 'next';
import { getRequestSupabase } from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const stationId = (req.query.stationId as string | undefined)?.trim();
    if (!stationId) return res.status(400).json({ error: 'stationId is required' });
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(stationId)) {
      return res.status(400).json({ error: 'Invalid stationId' });
    }

    const supabase = getRequestSupabase(req);
    if (!supabase) return res.status(401).json({ error: 'يجب تسجيل الدخول لعرض بيانات الجلسة الحالية.' });
    let [{ data, error }, { data: servicesData, error: servicesError }] = await Promise.all([
      supabase.rpc('fn_current_open_session_dashboard', { p_station_id: stationId }),
      supabase.rpc('fn_current_open_services', { p_station_id: stationId }),
    ]);
    if (error) {
      if (error.code === 'PGRST202') {
        data = await loadCurrentSessionFallback(supabase, stationId);
        error = null;
      }
    }
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
    if (servicesError && servicesError.code !== 'PGRST202') return res.status(500).json({ error: servicesError.message });

    const current = (data && typeof data === 'object') ? data as any : {};
    const services = (servicesData && typeof servicesData === 'object') ? servicesData as any : {};
    const [tankResult, expenseResult, meterResult] = await Promise.all([
      supabase
        .from('v_tank_status')
        .select('system_quantity,available_quantity,capacity')
        .eq('station_id', stationId)
        .eq('is_active', true),
      current.session?.id
        ? supabase.from('expenses').select('amount').eq('station_id', stationId).eq('session_id', current.session.id).eq('status', 'approved')
        : Promise.resolve({ data: [], error: null }),
      current.session?.id
        ? Promise.all([
            supabase.from('reconciliation_lines').select('id,tank_id,meter_readings_count').eq('session_id', current.session.id),
            supabase.from('reconciliation_meter_readings').select('reconciliation_line_id,meter_sold_qty').eq('session_id', current.session.id),
          ])
        : Promise.resolve([{ data: [], error: null }, { data: [], error: null }]),
    ]);

    const tankTotal = (tankResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row?.system_quantity ?? 0), 0);
    const tankAvailable = (tankResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row?.available_quantity ?? 0), 0);
    const tankCapacity = (tankResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row?.capacity ?? 0), 0);
    if (expenseResult.error) return res.status(500).json({ error: expenseResult.error.message });
    const meterReadings = (meterResult as any)[1]?.data || [];
    const meterSold = meterReadings.reduce((sum: number, row: any) => sum + Number(row.meter_sold_qty || 0), 0);
    const expenseTotal = (expenseResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row?.amount ?? 0), 0);
    const serviceTotal = paymentNumber(services.total);
    const serviceCount = Number(services.count ?? 0);
    const revenue = paymentNumber(current.total_revenue);
    const collected = paymentNumber(current.total_collected) + serviceTotal;
    const remaining = paymentNumber(current.total_remaining);
    const cost = paymentNumber(current.total_delivered_cost);
    const sold = paymentNumber(current.sold_quantity);
    const delivered = paymentNumber(current.delivered_quantity);

    const mergedSnapshot = {
      session: current.session ?? null,
      sales: Array.isArray(current.sales) ? current.sales : [],
      deliveries: Array.isArray(current.deliveries) ? current.deliveries : [],
      services: Array.isArray(services.services) ? services.services : [],
      by_fuel: Array.isArray(current.by_fuel) ? current.by_fuel : [],
      stock: {
        total_system: tankTotal,
        total_available: tankAvailable,
        total_capacity: tankCapacity,
      },
      today: {
        sold,
        delivered,
        delivery_count: Number(current.delivery_count ?? 0),
        sale_count: Number(current.sale_count ?? 0),
        service_count: serviceCount,
        total_collected: collected,
        total_revenue: revenue + serviceTotal,
        total_remaining: remaining,
        total_cost: cost,
        total_profit: collected - cost - expenseTotal,
        total_services: serviceTotal,
        total_expenses: expenseTotal,
        meter_sold: meterSold,
      },
      totals: {
        total_collected: collected,
        total_revenue: revenue + serviceTotal,
        total_remaining: remaining,
        total_cost: cost,
        total_profit: collected - cost - expenseTotal,
        total_services: serviceTotal,
        total_expenses: expenseTotal,
        meter_sold: meterSold,
      },
      trend: [],
    };

    return res.status(200).json({ snapshot: mergedSnapshot });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

async function loadCurrentSessionFallback(supabase: any, stationId: string) {
  const { data: session, error } = await supabase.from('reconciliation_sessions')
    .select('id, business_date, shift_id, shift_seq, status, opened_at, opened_by, total_variance')
    .eq('station_id', stationId).eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !session) return { session: null, sales: [], deliveries: [], by_fuel: [], total_collected: 0, total_delivered_cost: 0, sold_quantity: 0, delivered_quantity: 0, sale_count: 0, delivery_count: 0 };
  const [{ data: sales }, { data: deliveries }, { data: profile }] = await Promise.all([
    supabase.from('sales').select('id,business_date,created_at,quantity,unit_price,gross_amount,tank_id,fuel_type_id,pump_label,meter_open,meter_close,created_by').eq('station_id', stationId).eq('business_date', session.business_date).eq('shift_id', session.shift_id).eq('status', 'active'),
    supabase.from('deliveries').select('id,business_date,created_at,quantity,unit_cost,tank_id,fuel_type_id,supplier_id,created_by').eq('station_id', stationId).eq('business_date', session.business_date).eq('shift_id', session.shift_id).eq('status', 'active'),
    supabase.from('profiles').select('full_name').eq('id', session.opened_by).maybeSingle(),
  ]);
  const saleRows = sales || []; const deliveryRows = deliveries || [];
  const revenue = saleRows.reduce((sum: number, row: any) => sum + Number(row.gross_amount || Number(row.unit_price || 0) * Number(row.quantity || 0)), 0);
  const collected = saleRows.reduce((sum: number, row: any) => sum + Number(row.paid_amount || 0), 0);
  return { session: { ...session, opened_by_name: profile?.full_name || null }, sales: saleRows, deliveries: deliveryRows, by_fuel: [], total_revenue: revenue, total_collected: collected, total_remaining: Math.max(revenue - collected, 0), total_delivered_cost: deliveryRows.reduce((sum: number, row: any) => sum + Number(row.unit_cost || 0) * Number(row.quantity || 0), 0), sold_quantity: saleRows.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0), delivered_quantity: deliveryRows.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0), sale_count: saleRows.length, delivery_count: deliveryRows.length };
}

function paymentNumber(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}
