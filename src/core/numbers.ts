const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normalizeNumericInput(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value).trim();
  for (let index = 0; index < ARABIC_DIGITS.length; index += 1) {
    text = text.replaceAll(ARABIC_DIGITS[index] || "", String(index));
  }
  text = text.replace(/[\s\u00a0]/g, "").replace(/[رجمجنيهEGP]/gi, "").replace(/٬/g, ",").replace(/٫/g, ".");
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSeparator = lastDot > lastComma ? "." : ",";
    text = text.replace(decimalSeparator === "." ? /,/g : /\./g, "").replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    const fractionLength = text.length - lastComma - 1;
    text = fractionLength > 0 && fractionLength <= 2
      ? text.replace(",", ".")
      : text.replace(/,/g, "");
  }
  return text.replace(/[^0-9.+-]/g, "");
}

export function parseNumericInput(value: unknown): number | null {
  const normalized = normalizeNumericInput(value);
  if (!normalized || normalized === "." || normalized === "-" || normalized === "+") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function roundDecimal(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function formatNumber(value: unknown, decimals = 2): string {
  const parsed = typeof value === "number" ? value : parseNumericInput(value);
  if (parsed === null) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  }).format(parsed);
}

export function formatMoney(value: unknown, decimals = 2): string {
  const parsed = typeof value === "number" ? value : parseNumericInput(value);
  if (parsed === null) return "—";
  return `${formatNumber(parsed, decimals)} جنيه`;
}

export function formatQuantity(value: unknown, decimals = 3): string {
  const parsed = typeof value === "number" ? value : parseNumericInput(value);
  if (parsed === null) return "—";
  return `${formatNumber(parsed, decimals)} لتر`;
}

export function multiplyMoney(quantity: unknown, price: unknown): number {
  return roundDecimal((parseNumericInput(quantity) || 0) * (parseNumericInput(price) || 0), 2);
}
