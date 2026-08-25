import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatNumber,
  multiplyMoney,
  parseNumericInput,
} from "../src/core/numbers";

describe("numeric formatting and parsing", () => {
  it("accepts Arabic digits, decimal commas, and thousands separators", () => {
    expect(parseNumericInput("20,50")).toBe(20.5);
    expect(parseNumericInput("1,000.50")).toBe(1000.5);
    expect(parseNumericInput("١٬٢٥٠٫٧٥")).toBe(1250.75);
    expect(parseNumericInput("1,000")).toBe(1000);
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
