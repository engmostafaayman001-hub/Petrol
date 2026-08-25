import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import PageLayout from "../../src/components/PageLayout";
import { Button, PageHeader, SectionCard } from "../../src/components/ui";
import { useToast } from "../../src/components/ToastProvider";
import { useRequireAuth } from "../../src/lib/auth";
import { useCurrentStationId } from "../../src/lib/station";
import supabase from "../../src/lib/supabaseClient";
import { formatMoney, formatPrice, multiplyMoney, parseNumericInput } from "../../src/core/numbers";

const cairoDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export default function NewSale() {
  const { user } = useRequireAuth();
  const router = useRouter();
  const stationId = useCurrentStationId(user?.id ?? null);
  const { notify } = useToast();
  const [tanks, setTanks] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [form, setForm] = useState({
    tank_id: "",
    business_date: cairoDate(),
    quantity: "",
    customer_id: "",
    paid_amount: "",
    driver_name: "",
    vehicle_number: "",
    payment_method: "نقدي",
    sales_channel: "regular" as "regular" | "manual",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!stationId) return setTanks([]);
    supabase.auth
      .getSession()
      .then(
        ({ data }: { data: { session: { access_token?: string } | null } }) => {
          const headers: Record<string, string> = data.session?.access_token
            ? { Authorization: `Bearer ${data.session.access_token}` }
            : {};
          fetch(`/api/tanks?stationId=${encodeURIComponent(stationId)}`, {
            headers,
          })
            .then((r) => r.json())
            .then((d) => setTanks(d.tanks || []))
            .catch(() => setTanks([]));
          fetch(`/api/customers?stationId=${encodeURIComponent(stationId)}`, {
            headers,
          })
            .then((r) => r.json())
            .then((d) => setCustomers(d.customers || []))
            .catch(() => setCustomers([]));
        },
      );
  }, [stationId]);
  const selectedTank = tanks.find((tank) => tank.tank_id === form.tank_id);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const quantity = parseNumericInput(form.quantity) ?? NaN;
    const unitPrice = parseNumericInput(selectedTank?.selling_price || 0) ?? NaN;
    const total = multiplyMoney(quantity, unitPrice);
    const paid = parseNumericInput(form.paid_amount || 0) ?? NaN;
    const driverName = form.driver_name.trim();
    const vehicleNumber = form.vehicle_number.trim();
    if (
      !stationId ||
      !form.tank_id ||
      !form.business_date ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !form.customer_id
    )
      return setError(
        "أكمل العميل والخزان والتاريخ والكمية الصحيحة قبل الحفظ.",
      );
    if (paid < 0 || paid > total)
      return setError("المدفوع لا يمكن أن يتجاوز إجمالي العملية.");
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const response = await fetch("/api/sales/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth.session?.access_token
            ? { Authorization: `Bearer ${auth.session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          station_id: stationId,
          tank_id: form.tank_id,
          fuel_type_id: selectedTank?.fuel_type_id,
          business_date: form.business_date,
          quantity,
          unit_price: unitPrice,
          customer_id: form.customer_id,
          paid_amount: paid,
          driver_name: driverName,
          vehicle_number: vehicleNumber,
          payment_method: form.payment_method,
          sales_channel: form.sales_channel,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = [body.error, body.details, body.hint, body.code]
          .filter(Boolean)
          .join(" ");
        throw new Error(detail || `تعذر تسجيل عملية البيع (${response.status}).`);
      }
      notify("تم تسجيل عملية البيع بنجاح.");
      await router.push("/sales");
    } catch (reason: any) {
      setError(reason.message || "حدث خطأ أثناء حفظ العملية. حاول مرة أخرى.");
    } finally {
      setSaving(false);
    }
  }
  const unitPrice = parseNumericInput(selectedTank?.selling_price || 0) ?? 0;
  const total = multiplyMoney(form.quantity || 0, unitPrice);
  const remaining = Math.max(total - (parseNumericInput(form.paid_amount || 0) ?? 0), 0);
  return (
    <PageLayout title="تسجيل بيع">
      <PageHeader
        eyebrow="المبيعات"
        title="تسجيل عملية بيع"
        description="سجّل العملية على حساب العميل الموحد."
        actions={
          <Button
            variant="secondary"
            type="button"
            onClick={() => router.push("/sales")}
          >
            العودة للسجل
          </Button>
        }
      />
      <SectionCard
        title="بيانات العملية"
        description="ترتبط العملية تلقائيًا بالوردية المفتوحة للتاريخ المحدد."
        className="max-w-2xl"
      >
        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            <div className="form-field form-field-full">
              <label htmlFor="sale-customer">
                الشركة / العميل <span aria-hidden="true">*</span>
              </label>
              <select
                id="sale-customer"
                required
                value={form.customer_id}
                onChange={(event) =>
                  setForm({ ...form, customer_id: event.target.value })
                }
              >
                <option value="">اختر العميل المحفوظ</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="sale-tank">
                الخزان <span aria-hidden="true">*</span>
              </label>
              <select
                id="sale-tank"
                required
                value={form.tank_id}
                onChange={(event) =>
                  setForm({ ...form, tank_id: event.target.value })
                }
              >
                <option value="">اختر الخزان والوقود</option>
                {tanks.map((tank) => (
                  <option key={tank.tank_id} value={tank.tank_id}>
                    {tank.tank_code} — {tank.fuel_name}
                  </option>
                ))}
              </select>
              {selectedTank && (
                <small>
                  الرصيد المتاح:{" "}
                  {Number(
                    selectedTank.available_quantity ??
                      selectedTank.system_quantity ??
                      0,
                  ).toLocaleString("ar-EG")}{" "}
                  لتر
                </small>
              )}
            </div>
            <div className="form-field">
              <label htmlFor="sale-date">
                تاريخ العملية <span aria-hidden="true">*</span>
              </label>
              <input
                id="sale-date"
                required
                type="date"
                value={form.business_date}
                onChange={(event) =>
                  setForm({ ...form, business_date: event.target.value })
                }
              />
            </div>
            <div className="form-field">
              <label htmlFor="sale-quantity">
                الكمية باللتر <span aria-hidden="true">*</span>
              </label>
              <input
                id="sale-quantity"
                required
                min="0.001"
                step="0.001"
                inputMode="decimal"
                type="text"
                autoFocus
                value={form.quantity}
                onChange={(event) =>
                  setForm({ ...form, quantity: event.target.value })
                }
                placeholder="مثال: 50"
              />
            </div>
            <div className="form-field">
              <label>سعر الوحدة</label>
              <input readOnly value={formatPrice(unitPrice)} />
            </div>
            <div className="form-field">
              <label htmlFor="sale-channel">نوع البيع</label>
              <select
                id="sale-channel"
                value={form.sales_channel}
                onChange={(event) =>
                  setForm({ ...form, sales_channel: event.target.value as "regular" | "manual" })
                }
              >
                <option value="regular">مبيعات عادية</option>
                <option value="manual">مبيعات يدوية</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="sale-paid">المدفوع</label>
              <input
                id="sale-paid"
                min="0"
                step="0.01"
                type="text"
                value={form.paid_amount}
                onChange={(event) =>
                  setForm({ ...form, paid_amount: event.target.value })
                }
              />
            </div>
            <div className="form-field">
              <label>إجمالي العملية</label>
              <input readOnly value={formatMoney(total)} />
            </div>
            <div className="form-field">
              <label>المتبقي</label>
              <input readOnly value={formatMoney(remaining)} />
            </div>
            <div className="form-field">
              <label>اسم السائق</label>
              <input
                value={form.driver_name}
                onChange={(event) =>
                  setForm({ ...form, driver_name: event.target.value })
                }
              />
            </div>
            <div className="form-field">
              <label>رقم السيارة</label>
              <input
                value={form.vehicle_number}
                onChange={(event) =>
                  setForm({ ...form, vehicle_number: event.target.value })
                }
              />
            </div>
            <div className="form-field">
              <label>طريقة الدفع</label>
              <select
                value={form.payment_method}
                onChange={(event) =>
                  setForm({ ...form, payment_method: event.target.value })
                }
              >
                <option>نقدي</option>
                <option>تحويل بنكي</option>
                <option>آجل</option>
              </select>
            </div>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" loading={saving}>
              حفظ عملية البيع
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => router.push("/sales")}
            >
              إلغاء
            </Button>
          </div>
        </form>
      </SectionCard>
    </PageLayout>
  );
}
