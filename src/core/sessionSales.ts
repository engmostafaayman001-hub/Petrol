export type SessionSale = {
  quantity?: number | null;
  gross_amount?: number | null;
  sales_channel?: "regular" | "manual" | null;
};

export type SessionMeterReading = {
  meter_sold_qty?: number | null;
  meter_value?: number | null;
  closing_reading?: number | null;
};

export function getSessionSalesSummary(
  sales: SessionSale[],
  meterReadings: SessionMeterReading[],
) {
  const regularSalesQuantity = sales.reduce(
    (total, sale) => total + (sale.sales_channel === "manual" ? 0 : Number(sale.quantity || 0)),
    0,
  );
  const manualSalesQuantity = sales.reduce(
    (total, sale) => total + (sale.sales_channel === "manual" ? Number(sale.quantity || 0) : 0),
    0,
  );
  const registeredSalesQuantity = regularSalesQuantity + manualSalesQuantity;
  const registeredSalesAmount = sales.reduce((total, sale) => total + Number(sale.gross_amount || 0), 0);
  const regularSalesAmount = sales.reduce(
    (total, sale) => total + (sale.sales_channel === "manual" ? 0 : Number(sale.gross_amount || 0)),
    0,
  );
  const manualSalesAmount = sales.reduce(
    (total, sale) => total + (sale.sales_channel === "manual" ? Number(sale.gross_amount || 0) : 0),
    0,
  );
  const completedMeters = meterReadings.filter((reading) => reading.closing_reading != null);
  const meterQuantity = completedMeters.reduce((total, reading) => total + Number(reading.meter_sold_qty || 0), 0);
  const meterAmount = completedMeters.reduce((total, reading) => total + Number(reading.meter_value || 0), 0);
  const meterComplete = meterReadings.length > 0 && completedMeters.length === meterReadings.length;

  return {
    meterQuantity,
    regularSalesQuantity,
    manualSalesQuantity,
    registeredSalesQuantity,
    totalSalesQuantity: meterComplete ? meterQuantity : registeredSalesQuantity,
    registeredSalesAmount,
    regularSalesAmount,
    manualSalesAmount,
    totalSalesAmount: meterComplete ? meterAmount : registeredSalesAmount,
    settlementDifferenceQuantity: meterComplete ? meterQuantity - registeredSalesQuantity : null,
    meterComplete,
  };
}