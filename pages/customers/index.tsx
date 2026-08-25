import React, { useEffect, useState } from "react";
import PageLayout from "../../src/components/PageLayout";
import {
  Button,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../../src/components/ui";
import { useRequireAuth, useRole } from "../../src/lib/auth";
import { useCurrentStationId } from "../../src/lib/station";
import supabase from "../../src/lib/supabaseClient";
import { formatMoney as formatMoneyValue, parseNumericInput } from "../../src/core/numbers";
import { printDetails } from "../../src/lib/printDetails";

type Customer = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  driver_name?: string | null;
  vehicle_number?: string | null;
};
type Transaction = {
  id: string;
  transaction_type: string;
  debit: number;
  credit: number;
  amount: number;
  business_date: string;
  notes?: string | null;
};
const money = (value: number) => formatMoneyValue(value);
export default function CustomersPage() {
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const { role } = useRole();
  const isManager = role === "manager";
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [balance, setBalance] = useState(0);
  const [summary, setSummary] = useState({ operations: 0, total_sales: 0, total_paid: 0, total_due: 0 });
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [paymentMethod, setPaymentMethod] = useState("نقدي");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    driver_name: "",
    vehicle_number: "",
    notes: "",
  });
  const [message, setMessage] = useState("");
  async function token() {
    return (await supabase.auth.getSession()).data.session?.access_token || "";
  }
  async function load() {
    if (!stationId) return;
    const response = await fetch(
      `/api/customers?stationId=${encodeURIComponent(stationId)}`,
      { headers: { Authorization: `Bearer ${await token()}` } },
    );
    const data = await response.json();
    if (response.ok) setCustomers(data.customers || []);
  }
  useEffect(() => {
    load();
  }, [stationId]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/customers", {
      method: editing ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await token()}`,
      },
      body: JSON.stringify({ station_id: stationId, id: editing?.id, ...form }),
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error);
    setMessage(editing ? "تم تعديل العميل." : "تم حفظ العميل.");
    setEditing(null);
    setForm({ name: "", phone: "", email: "", address: "", driver_name: "", vehicle_number: "", notes: "" });
    setFormOpen(false);
    load();
  }
  function edit(customer: Customer) {
    setEditing(customer);
    setForm({ name: customer.name, phone: customer.phone || "", email: customer.email || "", address: customer.address || "", driver_name: customer.driver_name || "", vehicle_number: customer.vehicle_number || "", notes: "" });
    setFormOpen(true);
  }
  async function remove(customer: Customer) {
    if (!window.confirm("هل أنت متأكد من حذف هذا العميل نهائيًا؟ لا يمكن حذفه إذا كان مرتبطًا بمبيعات أو تحصيلات.")) return;
    const response = await fetch("/api/customers", { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ station_id: stationId, id: customer.id }) });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "تعذر تعطيل العميل.");
    setMessage("تم حذف العميل نهائيًا.");
    load();
  }
  async function view(customer: Customer) {
    const response = await fetch(
      `/api/customers?stationId=${encodeURIComponent(stationId || "")}&customerId=${customer.id}`,
      { headers: { Authorization: `Bearer ${await token()}` } },
    );
    const data = await response.json();
    if (response.ok) {
      setSelected(customer);
      setTransactions(data.transactions || []);
      setBalance(Number(data.balance || 0));
      setSummary(data.summary || { operations: 0, total_sales: 0, total_paid: 0, total_due: Number(data.balance || 0) });
    }
  }
  async function collect() {
    const amount = parseNumericInput(paymentAmount);
    if (!selected || amount === null || amount <= 0)
      return;
    const response = await fetch("/api/accounts/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await token()}`,
      },
      body: JSON.stringify({
        station_id: stationId,
        account_type: "customer",
        customer_id: selected.id,
        amount,
        business_date: paymentDate,
        payment_method: paymentMethod,
        notes: paymentNotes,
      }),
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error);
    setPaymentAmount("");
    setPaymentNotes("");
    setBalance(Number(data.balance));
    setMessage("تم تسجيل التحصيل.");
    view(selected);
  }
  return (
    <PageLayout title="العملاء">
      <main className="accounts-page" dir="rtl">
        <PageHeader
          eyebrow="الحسابات"
          title="العملاء والشركات"
          description="حساب موحد لكل شركة مع كشف حركة وتحصيلات."
          actions={
            <Button onClick={() => setFormOpen(true)}>إضافة عميل</Button>
          }
        />
        {message && <p className="form-error">{message}</p>}
        <div className="account-cards">
          {customers.map((customer) => (
            <article className="account-card" key={customer.id}>
              <header>
                <div>
                  <h3>{customer.name}</h3>
                  <small>{customer.phone || "لا يوجد هاتف"}</small>
                </div>
                <StatusBadge tone="info">حساب</StatusBadge>
              </header>
              <strong>{customer.driver_name || "لا يوجد سائق مسجل"} · {customer.vehicle_number || "لا يوجد رقم سيارة"}</strong>
              <div className="flex gap-2 flex-wrap">
              <button
                className="ui-button secondary"
                onClick={() => view(customer)}
              >
                عرض التفاصيل
              </button>
              {isManager && <><button className="ui-button secondary" onClick={() => edit(customer)}>تعديل</button><button className="ui-button danger" onClick={() => remove(customer)}>حذف</button></>}
              </div>
            </article>
          ))}
        </div>
        {formOpen && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <form
              className="ui-card form-card modal-card form-grid"
              onSubmit={save}
            >
              <h3>{editing ? "تعديل العميل" : "إضافة عميل"}</h3>
              {(["name", "phone", "email", "address", "driver_name", "vehicle_number", "notes"] as const).map(
                (field) => (
                  <div className="form-field" key={field}>
                    <label>
                      {field === "name"
                        ? "اسم الشركة أو العميل"
                        : field === "phone"
                          ? "الهاتف"
                          : field === "email"
                            ? "البريد الإلكتروني"
                            : field === "address"
                              ? "العنوان"
                              : field === "driver_name"
                                ? "اسم السائق"
                                : field === "vehicle_number"
                                  ? "رقم السيارة"
                                  : "ملاحظات"}
                    </label>
                    {field === "notes" ? (
                      <textarea
                        value={form[field]}
                        onChange={(e) =>
                          setForm({ ...form, [field]: e.target.value })
                        }
                      />
                    ) : (
                      <input
                        required={field === "name"}
                        type={field === "email" ? "email" : "text"}
                        value={form[field]}
                        onChange={(e) =>
                          setForm({ ...form, [field]: e.target.value })
                        }
                      />
                    )}
                  </div>
                ),
              )}
              <div className="form-actions">
                <Button type="submit">حفظ</Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setFormOpen(false)}
                >
                  إلغاء
                </Button>
              </div>
            </form>
          </div>
        )}
        {selected && (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            onMouseDown={() => setSelected(null)}
          >
            <section
              className="ui-card form-card modal-card"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <header className="section-card-header">
                <div>
                  <h3>{selected.name}</h3>
                  <p>المتبقي للتحصيل: {money(summary.total_due)}</p>
                </div>
                <div className="no-print flex gap-2">
                  <button type="button" className="ui-button secondary" onClick={printDetails}>طباعة</button>
                  <button className="modal-close" onClick={() => setSelected(null)}>×</button>
                </div>
              </header>
              <div className="account-summary-grid">
                <div><span>عدد العمليات</span><b>{summary.operations}</b></div>
                <div><span>إجمالي المبيعات</span><b>{money(summary.total_sales)}</b></div>
                <div><span>إجمالي المدفوع</span><b>{money(summary.total_paid)}</b></div>
                <div><span>المتبقي للتحصيل</span><b>{money(summary.total_due)}</b></div>
              </div>
              <div className="account-contact"><span>السائق: {selected.driver_name || "غير مسجل"}</span><span>رقم السيارة: {selected.vehicle_number || "غير مسجل"}</span></div>
              <div className="account-ledger">
                {transactions.length ? (
                  transactions.map((entry) => (
                    <div key={entry.id}>
                      <span>
                        {entry.business_date} · {entry.transaction_type}
                      </span>
                      <b className={entry.debit > 0 ? "text-red-600" : "text-green-600"}>{entry.debit > 0 ? money(entry.debit) : `- ${money(entry.credit)}`}</b>
                    </div>
                  ))
                ) : (
                  <p>لا توجد حركة مالية بعد.</p>
                )}
              </div>
              {balance > 0 && (
                <div className="account-payment">
                  <input
                    type="number"
                    min="0.01"
                    max={balance}
                    placeholder="مبلغ التحصيل"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                  />
                  <Button onClick={collect}>تحصيل مبلغ</Button>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </PageLayout>
  );
}
