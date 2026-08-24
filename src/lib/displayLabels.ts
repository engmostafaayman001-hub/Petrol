const serviceLabels: Record<string, string> = {
  car_wash: "غسيل سيارة",
  oil_change: "تغيير زيت",
  carpet_wash: "غسيل سجاد",
  blanket_wash: "غسيل بطانية",
  other: "أخرى",
};

export function serviceTypeLabel(value?: string | null) {
  return (value && serviceLabels[value]) || value || "خدمة";
}

export function shiftLabel(
  name?: string | null,
  code?: string | null,
  sequence?: number | null,
) {
  const value = String(name || code || "").trim();
  if (/^(morning|صباحية|صباحيه)$/i.test(value) || sequence === 1)
    return "الوردية الصباحية";
  if (/^(evening|مسائية|مسائيه)$/i.test(value) || sequence === 2)
    return "الوردية المسائية";
  const numbered = value.match(/^(?:shift|وردية)\s*(\d+)$/i);
  if (numbered) return `الوردية ${numbered[1]}`;
  return value || "الوردية الحالية";
}