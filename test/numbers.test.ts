import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatPrice,
  formatNumber,
  multiplyMoney,
  parseNumericInput,
} from "../src/core/numbers";
import { getSessionSalesSummary } from "../src/core/sessionSales";
import { can } from "../src/core/permissions";
import { calculateCustomerInternalTransaction } from "../src/core/customerInternal";

describe("numeric formatting and parsing", () => {
  it("accepts Arabic digits, decimal commas, and thousands separators", () => {
    expect(parseNumericInput("20,50")).toBe(20.5);
    expect(parseNumericInput("1,000.50")).toBe(1000.5);
    expect(parseNumericInput("١٬٢٥٠٫٧٥")).toBe(1250.75);
    expect(parseNumericInput("1,000")).toBe(1000);
    expect(parseNumericInput("20.62.86")).toBe(20.6286);
  });

  it("formats unit prices as pounds, piastres, and milliemes", () => {
    expect(formatPrice("20.62.86")).toBe("20.62.86 جنيه");
    expect(formatPrice("20.62.86", false)).toBe("20.62.86");
    expect(formatPrice(20.75)).toBe("20.75.00 جنيه");
  });

  it("uses meter sales as the total and keeps manual sales as a breakdown", () => {
    const summary = getSessionSalesSummary(
      [
        { quantity: 850, gross_amount: 17425, sales_channel: "regular" },
        { quantity: 150, gross_amount: 3075, sales_channel: "manual" },
      ],
      [{ closing_reading: 11000, meter_sold_qty: 1000, meter_value: 20500 }],
    );
    expect(summary.regularSalesQuantity).toBe(850);
    expect(summary.manualSalesQuantity).toBe(150);
    expect(summary.registeredSalesQuantity).toBe(1000);
    expect(summary.totalSalesQuantity).toBe(1000);
    expect(summary.totalSalesAmount).toBe(20500);
    expect(summary.settlementDifferenceQuantity).toBe(0);
  });

  it("does not use a partial meter set as the final total", () => {
    const summary = getSessionSalesSummary(
      [{ quantity: 480, gross_amount: 9840, sales_channel: "regular" }],
      [
        { closing_reading: 10500, meter_sold_qty: 500, meter_value: 10250 },
        { closing_reading: null, meter_sold_qty: null, meter_value: null },
      ],
    );
    expect(summary.meterComplete).toBe(false);
    expect(summary.totalSalesQuantity).toBe(480);
    expect(summary.totalSalesAmount).toBe(9840);
  });

  it("keeps a 50 litre settlement gap visible instead of adding it to sales", () => {
    const summary = getSessionSalesSummary(
      [
        { quantity: 850, gross_amount: 17425, sales_channel: "regular" },
        { quantity: 100, gross_amount: 2050, sales_channel: "manual" },
      ],
      [{ closing_reading: 11000, meter_sold_qty: 1000, meter_value: 20500 }],
    );
    expect(summary.totalSalesQuantity).toBe(1000);
    expect(summary.registeredSalesQuantity).toBe(950);
    expect(summary.settlementDifferenceQuantity).toBe(50);
  });

  it("does not turn duplicate manual input into 1100 litres", () => {
    const summary = getSessionSalesSummary(
      [
        { quantity: 1000, gross_amount: 20500, sales_channel: "regular" },
        { quantity: 100, gross_amount: 2050, sales_channel: "manual" },
      ],
      [{ closing_reading: 11000, meter_sold_qty: 1000, meter_value: 20500 }],
    );
    expect(summary.totalSalesQuantity).toBe(1000);
    expect(summary.registeredSalesQuantity).toBe(1100);
    expect(summary.settlementDifferenceQuantity).toBe(-100);
  });

  it("keeps two completed sessions additive without adding their breakdowns", () => {
    const morning = getSessionSalesSummary(
      [{ quantity: 900, sales_channel: "regular" }, { quantity: 100, sales_channel: "manual" }],
      [{ closing_reading: 11000, meter_sold_qty: 1000 }],
    );
    const evening = getSessionSalesSummary(
      [{ quantity: 1300, sales_channel: "regular" }, { quantity: 200, sales_channel: "manual" }],
      [{ closing_reading: 12500, meter_sold_qty: 1500 }],
    );
    expect(morning.totalSalesQuantity + evening.totalSalesQuantity).toBe(2500);
    expect(morning.manualSalesQuantity + evening.manualSalesQuantity).toBe(300);
    expect(morning.regularSalesQuantity + evening.regularSalesQuantity).toBe(2200);
  });

  it("preserves decimal meter value at two monetary places", () => {
    const summary = getSessionSalesSummary(
      [],
      [{ closing_reading: 11250.5, meter_sold_qty: 1250.5, meter_value: 25947.88 }],
    );
    expect(summary.totalSalesQuantity).toBe(1250.5);
    expect(summary.totalSalesAmount).toBe(25947.88);
  });

  it("allows record management only for the existing manager role", () => {
    expect(can("manager", "record:void")).toBe(true);
    expect(can("supervisor", "record:void")).toBe(false);
    expect(can("manager", "customer:manage")).toBe(true);
    expect(can("supervisor", "customer:manage")).toBe(true);
  });

  it("allows supervisors to manage reconciliation open and close operations", () => {
    expect(can("manager", "reconciliation:open")).toBe(true);
    expect(can("manager", "reconciliation:close")).toBe(true);
    expect(can("supervisor", "reconciliation:open")).toBe(true);
    expect(can("supervisor", "reconciliation:close")).toBe(true);
  });

  it("calculates customer internal transaction totals without fuel inventory logic", () => {
    expect(calculateCustomerInternalTransaction(10, 100, 50, 500)).toEqual({
      subtotal: 1000,
      total: 950,
      remaining: 450,
    });
  });

  it("formats money and large values consistently", () => {
    expect(formatMoney(1250000.5)).toBe("1,250,000.50 جنيه");
    expect(formatNumber(1000)).toBe("1,000.00");
  });

  it("rounds the final monetary product", () => {
    expect(multiplyMoney("1,250.50", "20.75")).toBe(25947.88);
    expect(formatMoney(multiplyMoney("1,250.50", "20.75"))).toBe("25,947.88 جنيه");
  });
});
