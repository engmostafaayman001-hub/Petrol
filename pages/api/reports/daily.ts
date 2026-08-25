import type { NextApiRequest, NextApiResponse } from "next";
import getServiceSupabase from "../../../src/lib/supabaseServer";
import { requireStationOperator } from "../../../src/lib/reconciliationAuth";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const stationId = String(req.query.stationId || "").trim();
    const requestedSessionId = String(req.query.sessionId || "").trim();
    let from = String(req.query.from || req.query.date || "").slice(0, 10);
    let to = String(req.query.to || from).slice(0, 10);
    if (!stationId || !from || !to || from > to)
      return res
        .status(400)
        .json({ error: "stationId and a valid date range are required" });
    await requireStationOperator(req, stationId);
    const supabase = getServiceSupabase();
    let selectedSession: any = null;
    if (requestedSessionId) {
      const { data, error } = await supabase.from("reconciliation_sessions").select("id,station_id,business_date,shift_id").eq("id", requestedSessionId).eq("station_id", stationId).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: "الجلسة غير موجودة لهذه المحطة." });
      selectedSession = data;
      from = data.business_date;
      to = data.business_date;
    }
    let salesQuery = supabase
      .from("v_sales")
      .select("fuel_type_id,fuel_name,gross_amount,paid_amount,quantity,unit_price")
      .eq("station_id", stationId)
      .eq("status", "active")
      .gte("business_date", from)
      .lte("business_date", to);
    if (selectedSession) salesQuery = salesQuery.eq("session_id", selectedSession.id);
    let deliveryQuery = supabase
      .from("v_deliveries")
      .select("fuel_type_id,fuel_name,total_cost,unit_cost,quantity")
      .eq("station_id", stationId)
      .eq("status", "active")
      .gte("business_date", from)
      .lte("business_date", to);
    if (selectedSession) deliveryQuery = deliveryQuery.eq("session_id", selectedSession.id);
    let serviceQuery = supabase
      .from("service_sales")
      .select("id,service_type,service_name,vehicle_type,amount,business_date,created_at,created_by")
      .eq("station_id", stationId)
      .eq("status", "active")
      .gte("business_date", from)
      .lte("business_date", to)
      .order("created_at", { ascending: false });
    if (selectedSession) serviceQuery = serviceQuery.eq("session_id", selectedSession.id);
    let expenseQuery = supabase
      .from("expenses")
      .select("id,session_id,business_date,category,description,amount,status,created_at")
      .eq("station_id", stationId)
      .eq("status", "approved")
      .gte("business_date", from)
      .lte("business_date", to)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (selectedSession) expenseQuery = expenseQuery.eq("session_id", selectedSession.id);
    let movementQuery: any = supabase
      .from("v_daily_fuel_movement")
      .select("*")
      .eq("station_id", stationId)
      .gte("business_date", from)
      .lte("business_date", to)
      .order("fuel_code");
    let meterLinesQuery: any = supabase
      .from("v_reconciliation_lines_current")
      .select("id,business_date,fuel_type_id,fuel_code,fuel_name,tank_code,shift_code,shift_name,meter_sold_qty,sold_qty,variance_qty,session_status,meter_readings_count")
      .eq("station_id", stationId)
      .gte("business_date", from)
      .lte("business_date", to)
      .not("meter_sold_qty", "is", null);
    if (selectedSession) meterLinesQuery = meterLinesQuery.eq("session_id", selectedSession.id);
    const [
      movementResult,
      salesResult,
      deliveryResult,
      serviceResult,
      sessionsResult,
      meterLinesResult,
      fuelPricesResult,
      expensesResult,
      accountTransactionsResult,
    ] = await Promise.all([
      movementQuery,
      salesQuery,
      deliveryQuery,
      serviceQuery,
      supabase
        .from("v_reconciliation_sessions")
        .select(
          "id,business_date,shift_code,shift_name,shift_seq,status,opened_at,submitted_at,total_sold,total_actual,total_variance",
        )
        .eq("station_id", stationId)
        .gte("business_date", from)
        .lte("business_date", to)
        .order("business_date", { ascending: false })
        .order("shift_seq", { ascending: false }),
      meterLinesQuery,
      supabase
        .from("fuel_types")
        .select("id,selling_price,purchase_price")
        .eq("station_id", stationId)
        .eq("is_active", true),
      expenseQuery,
      (() => {
        let query: any = supabase
          .from("account_transactions")
          .select("id,account_type,customer_id,supplier_id,transaction_type,amount,business_date,created_at,created_by,payment_method,notes")
          .eq("station_id", stationId)
          .gte("business_date", from)
          .lte("business_date", to)
          .order("created_at", { ascending: false });
        if (selectedSession) query = query.eq("session_id", selectedSession.id);
        return query;
      })(),
    ]);
    if (
      movementResult.error ||
      salesResult.error ||
      deliveryResult.error ||
      serviceResult.error ||
      sessionsResult.error ||
      meterLinesResult.error ||
      fuelPricesResult.error ||
      expensesResult.error ||
      (accountTransactionsResult.error && !/column .*session_id.*does not exist/i.test(accountTransactionsResult.error.message))
    )
      return res
        .status(500)
        .json({
          error:
            movementResult.error?.message ||
            salesResult.error?.message ||
            deliveryResult.error?.message ||
            serviceResult.error?.message ||
            sessionsResult.error?.message ||
            meterLinesResult.error?.message ||
            fuelPricesResult.error?.message ||
            expensesResult.error?.message ||
            accountTransactionsResult.error?.message,
        });
    const groups = new Map<string, any>();
    for (const row of movementResult.data || []) {
      const key = row.fuel_type_id;
      const current = groups.get(key) || {
        fuel_type_id: key,
        fuel_code: row.fuel_code,
        fuel_name: row.fuel_name,
        delivered: 0,
        sold: 0,
        variance: 0,
        adjusted: 0,
        movement_count: 0,
      };
      for (const field of [
        "delivered",
        "sold",
        "variance",
        "adjusted",
        "movement_count",
      ])
        current[field] += Number(row[field] || 0);
      groups.set(key, current);
    }
    for (const sale of salesResult.data || []) {
      const current = groups.get(sale.fuel_type_id) || {
        fuel_type_id: sale.fuel_type_id,
        fuel_name: sale.fuel_name,
        delivered: 0,
        sold: 0,
        variance: 0,
        adjusted: 0,
        movement_count: 0,
      };
      current.revenue =
        Number(current.revenue || 0) + Number(sale.gross_amount || 0);
      current.collected =
        Number(current.collected || 0) + Number(sale.paid_amount || 0);
      current.sales_quantity =
        Number(current.sales_quantity || 0) + Number(sale.quantity || 0);
      groups.set(sale.fuel_type_id, current);
    }
    const purchasePrices = new Map<string, number>(
      (fuelPricesResult.data || []).map((fuel: any) => [
        fuel.id,
        Number(fuel.purchase_price || 0),
      ]),
    );
    for (const delivery of deliveryResult.data || []) {
      const current = groups.get(delivery.fuel_type_id) || {
        fuel_type_id: delivery.fuel_type_id,
        fuel_name: delivery.fuel_name,
        delivered: 0,
        sold: 0,
        variance: 0,
        adjusted: 0,
        movement_count: 0,
      };
      const quantity = Number(delivery.quantity || 0);
      const invoiceCost = Number(delivery.total_cost || 0);
      const unitCost =
        Number(delivery.unit_cost || 0) ||
        Number(purchasePrices.get(delivery.fuel_type_id) || 0);
      current.cost =
        Number(current.cost || 0) + (invoiceCost || unitCost * quantity);
      current.delivery_cost_quantity =
        Number(current.delivery_cost_quantity || 0) + quantity;
      groups.set(delivery.fuel_type_id, current);
    }
    const meterSales = meterLinesResult.data || [];
    const meterByFuel = new Map<string, number>();
    for (const line of meterSales)
      meterByFuel.set(
        line.fuel_type_id,
        Number(meterByFuel.get(line.fuel_type_id) || 0) +
          Number(line.meter_sold_qty || 0),
      );
    const meterVarianceExpenseByFuel = new Map<string, number>();
    for (const line of meterSales) {
      const positiveVariance = Math.max(Number(line.variance_qty || 0), 0);
      meterVarianceExpenseByFuel.set(
        line.fuel_type_id,
        Number(meterVarianceExpenseByFuel.get(line.fuel_type_id) || 0) +
          positiveVariance,
      );
    }
    const rows = [...groups.values()].map((row: any) => {
      const revenue = Number(row.revenue || 0);
      const deliveredCost = Number(row.cost || 0);
      const deliveredQuantity = Number(row.delivery_cost_quantity || 0);
      const registeredQuantity = Number(row.sales_quantity || row.sold || 0);
      const meterQuantity = Number(meterByFuel.get(row.fuel_type_id) || 0);
      const soldQuantity = registeredQuantity;
      const averagePurchasePrice = deliveredQuantity
        ? deliveredCost / deliveredQuantity
        : 0;
      const costOfSales = soldQuantity * averagePurchasePrice;
      const meterVarianceQuantity = Number(
        meterVarianceExpenseByFuel.get(row.fuel_type_id) || 0,
      );
      const totalRevenue = revenue;
      const collected = Number(row.collected || 0);
      return {
        ...row,
        revenue: totalRevenue,
        registered_revenue: revenue,
        meter_revenue: 0,
        collected,
        remaining: Math.max(totalRevenue - collected, 0),
        procurement_cost: deliveredCost,
        cost: costOfSales,
        variance_expense: meterVarianceQuantity,
        profit: totalRevenue - costOfSales,
        average_sale_price: soldQuantity ? totalRevenue / soldQuantity : 0,
        average_purchase_price: averagePurchasePrice,
        meter_sold: meterQuantity,
        meter_variance_quantity: meterVarianceQuantity,
        net_change:
          Number(row.delivered || 0) -
          Number(row.sold || 0) +
          Number(row.adjusted || 0) +
          Number(row.variance || 0),
      };
    });
    const services = serviceResult.data || [];
    const serviceTotal = services.reduce(
      (total: number, service: any) => total + Number(service.amount || 0),
      0,
    );
    const fuelTotals = rows.reduce(
      (total: any, row: any) => ({
        collected: total.collected + row.collected,
        revenue: total.revenue + row.revenue,
        remaining: total.remaining + row.remaining,
        cost: total.cost + row.cost,
        profit: total.profit + row.profit,
      }),
      { collected: 0, revenue: 0, remaining: 0, cost: 0, profit: 0 },
    );
    const procurementCost = rows.reduce(
      (total: number, row: any) => total + Number(row.procurement_cost || 0),
      0,
    );
    const varianceExpense = rows.reduce(
      (total: number, row: any) => total + Number(row.variance_expense || 0),
      0,
    );
    const expenses = expensesResult.data || [];
    const accountTransactions = accountTransactionsResult.data || [];
    const reportSessionIds = (sessionsResult.data || []).map((session: any) => session.id);
    const meterReadingsResult = reportSessionIds.length
      ? await supabase.from("reconciliation_meter_readings").select("id,session_id,reconciliation_line_id,meter_id,reading_number,opening_reading,closing_reading,meter_sold_qty,unit_price,meter_value").in("session_id", reportSessionIds).order("created_at", { ascending: false })
      : { data: [], error: null };
    if (meterReadingsResult.error && !/does not exist/i.test(meterReadingsResult.error.message)) return res.status(500).json({ error: meterReadingsResult.error.message });
    const expenseTotal = expenses.reduce(
      (total: number, expense: any) => total + Number(expense.amount || 0),
      0,
    );
    const totals = {
      collected: fuelTotals.collected,
      revenue: fuelTotals.revenue + serviceTotal,
      remaining: fuelTotals.remaining,
      cost: fuelTotals.cost,
      procurement_cost: procurementCost,
      variance_expense: varianceExpense,
      expense_total: expenseTotal,
      profit: fuelTotals.profit + serviceTotal - expenseTotal,
      service_total: serviceTotal,
      service_count: services.length,
      customer_payment_total: accountTransactions.filter((entry: any) => entry.transaction_type === "customer_payment").reduce((total: number, entry: any) => total + Number(entry.amount || 0), 0),
      supplier_payment_total: accountTransactions.filter((entry: any) => entry.transaction_type === "supplier_payment").reduce((total: number, entry: any) => total + Number(entry.amount || 0), 0),
    };
    return res
      .status(200)
      .json({
        rows,
        totals,
        services,
        expenses,
        sessions: sessionsResult.data || [],
        meterSales,
        accountTransactions,
        meterReadings: meterReadingsResult.data || [],
      });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
