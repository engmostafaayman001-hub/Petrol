import type { NextApiRequest, NextApiResponse } from "next";
import getServiceSupabase from "../../../src/lib/supabaseServer";
import { requireStationOperator } from "../../../src/lib/reconciliationAuth";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const sessionId = (req.query.sessionId as string) || req.body.sessionId;
    if (!sessionId)
      return res.status(400).json({ error: "sessionId is required" });

    const supabase = getServiceSupabase();
    const { data: sessions, error: se } = await supabase
      .from("v_reconciliation_sessions")
      .select("*")
      .eq("id", sessionId)
      .limit(1)
      .single();
    if (se) return res.status(500).json({ error: se.message });
    if (!sessions)
      return res.status(404).json({ error: "جلسة التسوية غير موجودة." });
    try {
      await requireStationOperator(req, sessions.station_id);
    } catch (error: any) {
      return res.status(401).json({ error: error.message });
    }

    const { data: lines, error: le } = await supabase
      .from("v_reconciliation_lines_current")
      .select("*")
      .eq("session_id", sessionId)
      .order("tank_code", { ascending: true });
    if (le) return res.status(500).json({ error: le.message });
    const { data: meterLines, error: meterLinesError } = await supabase
      .from("reconciliation_lines")
      .select("id,meter2_id,opening_meter2,closing_meter2,meter_readings_count")
      .eq("session_id", sessionId);
    if (meterLinesError)
      return res.status(500).json({ error: meterLinesError.message });
    const meterLineMap = new Map(
      (meterLines || []).map((line: any) => [line.id, line]),
    );
    const { data: storedReadings, error: storedReadingsError } = await supabase
      .from("reconciliation_meter_readings")
      .select("id,reconciliation_line_id,meter_id,reading_number,opening_reading,closing_reading,meter_sold_qty")
      .eq("session_id", sessionId)
      .order("reading_number", { ascending: true });
    if (storedReadingsError && !/does not exist/i.test(storedReadingsError.message))
      return res.status(500).json({ error: storedReadingsError.message });
    const tankIds = (lines || []).map((line: any) => line.tank_id).filter(Boolean);
    const { data: tankMeters, error: tankMetersError } = tankIds.length
      ? await supabase.from("pump_meters").select("id,tank_id,code,name,meter_slot,is_active").in("tank_id", tankIds).eq("station_id", sessions.station_id).eq("is_active", true)
      : { data: [], error: null };
    if (tankMetersError) return res.status(500).json({ error: tankMetersError.message });
    const metersByTank = new Map<string, any[]>();
    (tankMeters || []).forEach((meter: any) => metersByTank.set(meter.tank_id, [...(metersByTank.get(meter.tank_id) || []), meter]));
    const meterIds = Array.from(new Set((lines || []).flatMap((line: any) => {
      const available = metersByTank.get(line.tank_id) || [];
      return [line.meter_id || available.find((meter) => meter.meter_slot === 1)?.id, meterLineMap.get(line.id)?.meter2_id || available.find((meter) => meter.meter_slot === 2)?.id, ...(storedReadings || []).filter((reading: any) => reading.reconciliation_line_id === line.id).map((reading: any) => reading.meter_id)].filter(Boolean);
    })));
    const { data: meters, error: metersError } = meterIds.length
      ? await supabase.from("pump_meters").select("id,code,name,meter_slot").in("id", meterIds)
      : { data: [], error: null };
    if (metersError) return res.status(500).json({ error: metersError.message });
    const meterMap = new Map((meters || []).map((meter: any) => [meter.id, meter]));
    const enrichedLines = (lines || []).map((line: any) => ({
      ...line,
      ...(meterLineMap.get(line.id) || {}),
      meter_readings: (storedReadings || []).filter((reading: any) => reading.reconciliation_line_id === line.id).map((reading: any) => ({ ...reading, meter_code: meterMap.get(reading.meter_id)?.code || null, meter_name: meterMap.get(reading.meter_id)?.name || null })),
      meter_id: line.meter_id || metersByTank.get(line.tank_id)?.find((meter) => meter.meter_slot === 1)?.id || null,
      meter2_id: meterLineMap.get(line.id)?.meter2_id || metersByTank.get(line.tank_id)?.find((meter) => meter.meter_slot === 2)?.id || null,
      meter_code: meterMap.get(line.meter_id || metersByTank.get(line.tank_id)?.find((meter) => meter.meter_slot === 1)?.id)?.code || null,
      meter_name: meterMap.get(line.meter_id || metersByTank.get(line.tank_id)?.find((meter) => meter.meter_slot === 1)?.id)?.name || null,
      meter2_code: meterMap.get(meterLineMap.get(line.id)?.meter2_id || metersByTank.get(line.tank_id)?.find((meter) => meter.meter_slot === 2)?.id)?.code || null,
      meter2_name: meterMap.get(meterLineMap.get(line.id)?.meter2_id || metersByTank.get(line.tank_id)?.find((meter) => meter.meter_slot === 2)?.id)?.name || null,
    }));

    let salesQuery: any = supabase
      .from("v_sales")
      .select("id,fuel_type_id,fuel_name,quantity,gross_amount,paid_amount,created_at,created_by_name,customer_id,session_id")
      .eq("station_id", sessions.station_id)
      .eq("business_date", sessions.business_date)
      .eq("shift_id", sessions.shift_id)
      .or(`session_id.eq.${sessionId},and(session_id.is.null,business_date.eq.${sessions.business_date},shift_id.eq.${sessions.shift_id})`)
      .eq("status", "active");
    let { data: sales, error: salesError } = await salesQuery;
    if (salesError && /column .* does not exist/i.test(salesError.message)) {
      salesQuery = supabase
        .from("v_sales")
        .select("id,fuel_type_id,fuel_name,quantity,gross_amount,created_at,created_by_name")
        .eq("station_id", sessions.station_id)
        .eq("business_date", sessions.business_date)
        .eq("shift_id", sessions.shift_id)
        .eq("status", "active");
      const legacySales = await salesQuery;
      sales = (legacySales.data || []).map((sale: any) => ({ ...sale, paid_amount: 0, customer_id: null, session_id: null }));
      salesError = legacySales.error;
    }
    if (salesError) return res.status(500).json({ error: salesError.message });
    const customerIds = Array.from(new Set((sales || []).map((sale: any) => sale.customer_id).filter(Boolean)));
    const { data: customers, error: customersError } = customerIds.length
      ? await supabase.from("customers").select("id,name").in("id", customerIds)
      : { data: [], error: null };
    if (customersError) return res.status(500).json({ error: customersError.message });
    const customerNames = new Map((customers || []).map((customer: any) => [customer.id, customer.name]));
    let deliveriesQuery: any = supabase
      .from("v_deliveries")
      .select("id,fuel_type_id,fuel_name,quantity,total_cost,unit_cost,created_at,created_by_name,supplier_id,supplier_name,session_id")
      .eq("station_id", sessions.station_id)
      .eq("business_date", sessions.business_date)
      .eq("shift_id", sessions.shift_id)
      .or(`session_id.eq.${sessionId},and(session_id.is.null,business_date.eq.${sessions.business_date},shift_id.eq.${sessions.shift_id})`)
      .eq("status", "active");
    let { data: deliveries, error: deliveriesError } = await deliveriesQuery;
    if (deliveriesError && /column .* does not exist/i.test(deliveriesError.message)) {
      deliveriesQuery = supabase
        .from("v_deliveries")
        .select("id,fuel_type_id,fuel_name,quantity,total_cost,unit_cost,created_at,created_by_name,supplier_id,supplier_name")
        .eq("station_id", sessions.station_id)
        .eq("business_date", sessions.business_date)
        .eq("shift_id", sessions.shift_id)
        .eq("status", "active");
      const legacyDeliveries = await deliveriesQuery;
      deliveries = (legacyDeliveries.data || []).map((delivery: any) => ({ ...delivery, session_id: null }));
      deliveriesError = legacyDeliveries.error;
    }
    if (deliveriesError) return res.status(500).json({ error: deliveriesError.message });
    const { data: services, error: servicesError } = await supabase
      .from("service_sales")
      .select(
        "id,service_type,service_name,vehicle_type,amount,created_at,created_by",
      )
      .eq("station_id", sessions.station_id)
      .eq("session_id", sessions.id)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    if (
      servicesError &&
      !String(servicesError.message).toLowerCase().includes("does not exist")
    )
      return res.status(500).json({ error: servicesError.message });
    const cashByFuel = Object.values(
      (sales || []).reduce((groups: Record<string, any>, sale: any) => {
        const current = groups[sale.fuel_type_id] || {
          fuel_type_id: sale.fuel_type_id,
          fuel_name: sale.fuel_name,
          quantity: 0,
          revenue: 0,
          collected: 0,
          remaining: 0,
        };
        current.quantity += Number(sale.quantity || 0);
        current.revenue += Number(sale.gross_amount || 0);
        current.collected += Number(sale.paid_amount || 0);
        current.remaining += Math.max(Number(sale.gross_amount || 0) - Number(sale.paid_amount || 0), 0);
        groups[sale.fuel_type_id] = current;
        return groups;
      }, {}),
    );
    const totalCollected = (cashByFuel as any[]).reduce(
      (total, row) => total + row.collected,
      0,
    );
    const serviceTotal = (services || []).reduce(
      (total: number, service: any) => total + Number(service.amount || 0),
      0,
    );
    const deliveryTotal = (deliveries || []).reduce((total: number, delivery: any) => total + Number(delivery.total_cost || 0), 0);
    const { data: expenses, error: expensesError } = await supabase
      .from("expenses")
      .select("id,category,description,amount,business_date,created_at,created_by,status")
      .eq("station_id", sessions.station_id)
      .eq("session_id", sessions.id)
      .eq("status", "approved")
      .order("created_at", { ascending: false });
    if (expensesError) return res.status(500).json({ error: expensesError.message });
    const expenseTotal = (expenses || []).reduce((total: number, expense: any) => total + Number(expense.amount || 0), 0);
    const operations = [
      ...(sales || []).map((sale: any) => ({ id: sale.id, occurred_at: sale.created_at, type: 'sale', detail: sale.fuel_name, quantity: Number(sale.quantity || 0), value: Number(sale.gross_amount || 0), user: sale.created_by_name, account: customerNames.get(sale.customer_id) || null, status: 'active' })),
      ...(deliveries || []).map((delivery: any) => ({ id: delivery.id, occurred_at: delivery.created_at, type: 'delivery', detail: delivery.fuel_name, quantity: Number(delivery.quantity || 0), value: Number(delivery.total_cost || 0), user: delivery.created_by_name, account: delivery.supplier_name, status: 'active' })),
      ...(services || []).map((service: any) => ({ id: service.id, occurred_at: service.created_at, type: 'service', detail: service.service_name || service.service_type, quantity: 0, value: Number(service.amount || 0), user: service.created_by, account: null, status: 'active' })),
    ].sort((left, right) => String(right.occurred_at || '').localeCompare(String(left.occurred_at || '')));
    const totalRevenue = (cashByFuel as any[]).reduce((total, row) => total + row.revenue, 0) + serviceTotal;
    const totalRemaining = (cashByFuel as any[]).reduce((total, row) => total + row.remaining, 0);

    return res
      .status(200)
      .json({
        session: {
          ...sessions,
          total_revenue: totalRevenue,
          total_collected: totalCollected + serviceTotal,
          total_remaining: totalRemaining,
          sale_count: sales?.length || 0,
          sold_quantity: (sales || []).reduce((total: number, sale: any) => total + Number(sale.quantity || 0), 0),
          delivery_count: deliveries?.length || 0,
          delivered_quantity: (deliveries || []).reduce((total: number, delivery: any) => total + Number(delivery.quantity || 0), 0),
          delivery_total: deliveryTotal,
          expense_total: expenseTotal,
          net_collected: totalCollected + serviceTotal - expenseTotal,
          total_service_sales: serviceTotal,
          operations,
        },
        lines: enrichedLines,
        cashByFuel,
        deliveries: deliveries || [],
        expenses: expenses || [],
        operations,
        services: services || [],
      });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
