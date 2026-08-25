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
      .select("fuel_type_id,fuel_name,gross_amount,paid_amount,quantity,unit_price,session_id")
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
    const reportSessionIds = (sessionsResult.data || []).map((session: any) => session.id);
    const reportSessionIdSet = new Set(reportSessionIds);
    const scopedSales = (salesResult.data || []).filter((sale: any) => reportSessionIdSet.has(sale.session_id));
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
    for (const sale of scopedSales) {
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
    let rows = [...groups.values()].map((row: any) => {
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
    const customerPaymentTotal = accountTransactions.filter((entry: any) => entry.transaction_type === "customer_payment").reduce((total: number, entry: any) => total + Number(entry.amount || 0), 0);
    const supplierPaymentTotal = accountTransactions.filter((entry: any) => entry.transaction_type === "supplier_payment").reduce((total: number, entry: any) => total + Number(entry.amount || 0), 0);
    const meterReadingsResult = reportSessionIds.length
      ? await supabase.from("reconciliation_meter_readings").select("id,session_id,reconciliation_line_id,meter_id,reading_number,opening_reading,closing_reading,meter_sold_qty,unit_price,meter_value").in("session_id", reportSessionIds).order("recorded_at", { ascending: false })
      : { data: [], error: null };
    if (meterReadingsResult.error && !/does not exist/i.test(meterReadingsResult.error.message)) return res.status(500).json({ error: meterReadingsResult.error.message });
    const sessionSummaryResults = await Promise.all(
      reportSessionIds.map((id: string) => supabase.rpc("fn_session_sales_summary", { p_session_id: id })),
    );
    if (sessionSummaryResults.some((result: any) => result.error)) {
      const summaryError = sessionSummaryResults.find((result: any) => result.error)?.error;
      return res.status(500).json({ error: summaryError?.message || "تعذر حساب ملخص مبيعات الجلسة." });
    }
    const sessionSummaries = sessionSummaryResults.map((result: any, index: number) => ({
      session_id: reportSessionIds[index],
      ...(result.data || {}),
    }));
    const summaryTotals = sessionSummaries.reduce((total: any, summary: any) => ({
      meterQuantity: total.meterQuantity + Number(summary.meterQuantity || 0),
      regularSalesQuantity: total.regularSalesQuantity + Number(summary.regularSalesQuantity || 0),
      manualSalesQuantity: total.manualSalesQuantity + Number(summary.manualSalesQuantity || 0),
      registeredSalesQuantity: total.registeredSalesQuantity + Number(summary.registeredSalesQuantity || 0),
      totalSalesQuantity: total.totalSalesQuantity + Number(summary.totalSalesQuantity || 0),
      totalSalesAmount: total.totalSalesAmount + Number(summary.totalSalesAmount || 0),
      registeredSalesAmount: total.registeredSalesAmount + Number(summary.registeredSalesAmount || 0),
      settlementDifferenceQuantity: total.settlementDifferenceQuantity + Number(summary.settlementDifferenceQuantity || 0),
    }), { meterQuantity: 0, regularSalesQuantity: 0, manualSalesQuantity: 0, registeredSalesQuantity: 0, totalSalesQuantity: 0, totalSalesAmount: 0, registeredSalesAmount: 0, settlementDifferenceQuantity: 0 });
    const sessionsWithSales = (sessionsResult.data || []).map((session: any) => {
      const summary = sessionSummaries.find((item: any) => item.session_id === session.id);
      return {
        ...session,
        total_sales_quantity: summary?.totalSalesQuantity ?? 0,
        regular_sales_quantity: summary?.regularSalesQuantity ?? 0,
        manual_sales_quantity: summary?.manualSalesQuantity ?? 0,
        registered_sales_quantity: summary?.registeredSalesQuantity ?? 0,
        settlement_difference_quantity: summary?.settlementDifferenceQuantity ?? null,
        meter_complete: summary?.meterComplete ?? false,
      };
    });
    const summaryByFuel = new Map<string, any>();
    for (const summary of sessionSummaries) {
      for (const fuel of summary.byFuel || []) {
        const current = summaryByFuel.get(fuel.fuel_type_id) || { registered_quantity: 0, regular_quantity: 0, manual_quantity: 0, registered_amount: 0, meter_quantity: 0, meter_amount: 0 };
        current.registered_quantity += Number(fuel.registered_quantity || 0);
        current.regular_quantity += Number(fuel.regular_quantity || 0);
        current.manual_quantity += Number(fuel.manual_quantity || 0);
        current.registered_amount += Number(fuel.registered_amount || 0);
        current.meter_quantity += Number(fuel.meter_quantity || 0);
        current.meter_amount += Number(fuel.meter_amount || 0);
        summaryByFuel.set(fuel.fuel_type_id, current);
      }
    }
    rows = rows.map((row: any) => {
      const breakdown = summaryByFuel.get(row.fuel_type_id);
      if (!breakdown) return row;
      const hasCompletedMeter = sessionSummaries.some((summary: any) => summary.meterComplete);
      const actualQuantity = hasCompletedMeter ? breakdown.meter_quantity : breakdown.registered_quantity;
      const actualRevenue = hasCompletedMeter ? breakdown.meter_amount : breakdown.registered_amount;
      const averagePurchasePrice = Number(row.average_purchase_price || 0);
      const cost = actualQuantity * averagePurchasePrice;
      return {
        ...row,
        revenue: actualRevenue,
        registered_revenue: breakdown.registered_amount,
        meter_revenue: actualRevenue,
        regular_sales_quantity: breakdown.regular_quantity,
        manual_sales_quantity: breakdown.manual_quantity,
        registered_sales_quantity: breakdown.registered_quantity,
        total_sales_quantity: actualQuantity,
        settlement_difference_quantity: breakdown.meter_quantity - breakdown.registered_quantity,
        meter_sold: breakdown.meter_quantity,
        cost,
        profit: actualRevenue - cost,
        average_sale_price: actualQuantity ? actualRevenue / actualQuantity : 0,
      };
    });
    const expenseTotal = expenses.reduce(
      (total: number, expense: any) => total + Number(expense.amount || 0),
      0,
    );
    const totals = {
      collected: fuelTotals.collected,
      revenue: Number(summaryTotals.totalSalesAmount || fuelTotals.revenue) + serviceTotal,
      remaining: fuelTotals.remaining,
      cost: fuelTotals.cost,
      procurement_cost: procurementCost,
      variance_expense: varianceExpense,
      expense_total: expenseTotal,
      profit: fuelTotals.profit + serviceTotal - expenseTotal,
      service_total: serviceTotal,
      service_count: services.length,
      customer_payment_total: customerPaymentTotal,
      supplier_payment_total: supplierPaymentTotal,
      net_cash: fuelTotals.collected + serviceTotal + customerPaymentTotal - supplierPaymentTotal - expenseTotal,
    };
    return res
      .status(200)
      .json({
        rows,
        totals,
        services,
        expenses,
        sessions: sessionsWithSales,
        meterSales,
        accountTransactions,
        meterReadings: meterReadingsResult.data || [],
        sessionSummaries,
        salesSummary: summaryTotals,
      });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
