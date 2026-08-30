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
import { LoadingState } from "../../src/components/DataState";

type Customer = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
};
type Transaction = {
  id: string;
  transaction_type: string;
  debit: number;
  credit: number;
  amount: number;
  business_date: string;
  notes?: string | null;
  reference_id?: string | null;
};
const money = (value: number) => formatMoneyValue(value);
const transactionLabel = (type: string) => ({
  sale: "بيع آجل",
  customer_payment: "تحصيل من العميل",
  adjustment: "تسوية حساب",
}[type] || "حركة حساب");
export default function CustomersPage() {
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const { role } = useRole();
  const canManageAccounts = role === "manager" || role === "supervisor";
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
    notes: "",
  });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [tanks, setTanks] = useState<any[]>([]);
  const [saleFormOpen, setSaleFormOpen] = useState(false);
  const [saleForm, setSaleForm] = useState({ tank_id: "", quantity: "", paid_amount: "", business_date: new Date().toISOString().slice(0, 10), driver_name: "", vehicle_number: "" });
  async function token() {
    return (await supabase.auth.getSession()).data.session?.access_token || "";
  }
  async function load() {
    if (!stationId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/customers?stationId=${encodeURIComponent(stationId)}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const data = await response.json();
      if (response.ok) setCustomers(data.customers || []); else setMessage(data.error || "تعذر تحميل العملاء.");
    } finally { setLoading(false); }
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
    setForm({ name: "", phone: "", email: "", address: "", notes: "" });
    setFormOpen(false);
    load();
  }
  function edit(customer: Customer) {
    if (!canManageAccounts) return;
    setEditing(customer);
    setForm({ name: customer.name, phone: customer.phone || "", email: customer.email || "", address: customer.address || "", notes: "" });
    setFormOpen(true);
  }
  async function remove(customer: Customer) {
    if (!isManager) return;
    if (!window.confirm("هل أنت متأكد من حذف هذا العميل نهائيًا؟ لا يمكن حذفه إذا كان مرتبطًا بمبيعات أو تحصيلات.")) return;
    const response = await fetch("/api/customers", { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ station_id: stationId, id: customer.id }) });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "تعذر تعطيل العميل.");
    setMessage("تم حذف العميل نهائيًا.");
    if (selected?.id === customer.id) setSelected(null);
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
  async function saveSale(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const tank = tanks.find((item) => item.tank_id === saleForm.tank_id);
    const quantity = parseNumericInput(saleForm.quantity);
    const paidAmount = parseNumericInput(saleForm.paid_amount || 0);
    if (!stationId || !tank || quantity === null || quantity <= 0 || paidAmount === null || paidAmount < 0) return setMessage("أكمل الخزان والكمية والمدفوع بشكل صحيح.");
    const response = await fetch("/api/sales/create", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ station_id: stationId, tank_id: tank.tank_id, fuel_type_id: tank.fuel_type_id, business_date: saleForm.business_date, quantity, unit_price: Number(tank.selling_price || 0), customer_id: selected.id, paid_amount: paidAmount, driver_name: saleForm.driver_name, vehicle_number: saleForm.vehicle_number, payment_method: "نقدي" }) });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "تعذر تسجيل عملية البيع.");
    setSaleFormOpen(false);
    setSaleForm({ tank_id: "", quantity: "", paid_amount: "", business_date: new Date().toISOString().slice(0, 10), driver_name: "", vehicle_number: "" });
    setMessage("تم تسجيل عملية البيع.");
    view(selected);
  }
  async function openSaleForm() {
    if (!stationId) return;
    const response = await fetch(`/api/tanks?stationId=${encodeURIComponent(stationId)}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "تعذر تحميل الخزانات.");
    setTanks(data.tanks || []);
    setSaleFormOpen(true);
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
  async function manageAccountEntry(entry: Transaction, action: 'edit' | 'delete') {
    if (!isManager || !selected) return;
    const isPayment = entry.transaction_type === 'customer_payment';
    const sourceId = entry.reference_id;
    if (!isPayment && (entry.transaction_type !== 'sale' || !sourceId)) return setMessage('لا يمكن تعديل هذه الحركة من كشف الحساب.');
    if (action === 'delete' && !window.confirm('هل تريد إلغاء هذه الحركة؟')) return;
    let response: Response;
    if (isPayment) {
      const amount = action === 'edit' ? window.prompt('مبلغ التحصيل الجديد', String(entry.credit || entry.amount || 0)) : null;
      if (action === 'edit' && (!amount || Number(amount) <= 0)) return;
      response = await fetch(`/api/accounts/payment?id=${encodeURIComponent(entry.id)}&stationId=${encodeURIComponent(stationId || '')}`, { method: action === 'edit' ? 'PATCH' : 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: action === 'edit' ? JSON.stringify({ station_id: stationId, amount }) : JSON.stringify({ station_id: stationId }) });
    } else {
      const quantity = action === 'edit' ? window.prompt('الكمية الجديدة باللتر') : null;
      const reason = window.prompt('سبب التعديل أو الإلغاء') || '';
      if (action === 'edit' && (!quantity || Number(quantity) <= 0)) return;
      response = await fetch(`/api/sales/manage?id=${encodeURIComponent(sourceId || '')}`, { method: action === 'edit' ? 'PATCH' : 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify(action === 'edit' ? { reason, payload: { quantity: Number(quantity) } } : { reason }) });
    }
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || 'تعذر تعديل حركة الحساب.');
    setMessage(action === 'edit' ? 'تم تعديل الحركة.' : 'تم إلغاء الحركة.');
    view(selected);
  }
  const selectedSaleTank = tanks.find((tank) => tank.tank_id === saleForm.tank_id);
  const saleUnitPrice = Number(selectedSaleTank?.selling_price || 0);
  const saleQuantity = parseNumericInput(saleForm.quantity) || 0;
  const saleTotal = Math.max(saleQuantity * saleUnitPrice, 0);
  const salePaid = parseNumericInput(saleForm.paid_amount) || 0;
  const saleRemaining = Math.max(saleTotal - salePaid, 0);
  return (
    <PageLayout title="العملاء">
      <main className="accounts-page" dir="rtl">
        <PageHeader
          eyebrow="الحسابات"
          title="العملاء والشركات"
          description="حساب موحد لكل شركة مع كشف حركة وتحصيلات."
          actions={canManageAccounts ? <Button onClick={() => setFormOpen(true)}>إضافة عميل</Button> : undefined}
        />
        {message && <p className="form-error">{message}</p>}
        {loading ? <LoadingState /> : <div className="account-cards">
          {customers.map((customer) => (
            <article className="account-card" key={customer.id}>
              <header>
                <div>
                  <h3>{customer.name}</h3>
                  <small>{customer.phone || "لا يوجد هاتف"}</small>
                </div>
                <StatusBadge tone="info">حساب</StatusBadge>
              </header>
              <strong>حساب العميل وعمليات البيع</strong>
              <div className="flex gap-2 flex-wrap">
              <button
                className="ui-button secondary"
                onClick={() => view(customer)}
              >
                عرض التفاصيل
              </button>
              {canManageAccounts && <button className="ui-button secondary" onClick={() => edit(customer)}>تعديل</button>}{isManager && <button className="ui-button danger" onClick={() => remove(customer)}>حذف</button>}
              </div>
            </article>
          ))}
        </div>}
        {formOpen && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <form
              className="ui-card form-card modal-card form-grid"
              onSubmit={save}
            >
              <h3>{editing ? "تعديل العميل" : "إضافة عميل"}</h3>
              {(["name", "phone", "email", "address", "notes"] as const).map(
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
                  <button type="button" className="ui-button secondary" onClick={openSaleForm}>إضافة عملية بيع</button>
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
              <div className="account-ledger">
                {transactions.length ? (
                  transactions.map((entry) => (
                    <div key={entry.id}>
                      <span>
                        {entry.business_date} · {transactionLabel(entry.transaction_type)}
                      </span>
                      <span className="flex items-center gap-2"><b className={entry.debit > 0 ? "text-red-600" : "text-green-600"}>{entry.debit > 0 ? money(entry.debit) : `- ${money(entry.credit)}`}</b>{isManager && ['sale', 'customer_payment'].includes(entry.transaction_type) && <><button type="button" className="text-blue-700" onClick={() => manageAccountEntry(entry, 'edit')}>تعديل</button><button type="button" className="text-red-700" onClick={() => manageAccountEntry(entry, 'delete')}>حذف</button></>}</span>
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
        {saleFormOpen && selected && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <form className="ui-card form-card modal-card form-grid" onSubmit={saveSale}>
              <h3>إضافة عملية بيع إلى {selected.name}</h3>
              <div className="form-field form-field-full"><label>الخزان والوقود</label><select required value={saleForm.tank_id} onChange={(event) => setSaleForm({ ...saleForm, tank_id: event.target.value })}><option value="">اختر الخزان</option>{tanks.map((tank) => <option key={tank.tank_id} value={tank.tank_id}>{tank.tank_code} - {tank.fuel_name}</option>)}</select></div>
              <div className="form-field"><label>التاريخ</label><input required type="date" value={saleForm.business_date} onChange={(event) => setSaleForm({ ...saleForm, business_date: event.target.value })} /></div>
              <div className="form-field"><label>الكمية باللتر</label><input required inputMode="decimal" value={saleForm.quantity} onChange={(event) => setSaleForm({ ...saleForm, quantity: event.target.value })} /></div>
              <div className="form-field"><label>سعر الوحدة المحفوظ</label><input readOnly value={money(saleUnitPrice)} /></div>
              <div className="form-field"><label>إجمالي العملية</label><input readOnly value={money(saleTotal)} /></div>
              <div className="form-field"><label>اسم السائق</label><input value={saleForm.driver_name} onChange={(event) => setSaleForm({ ...saleForm, driver_name: event.target.value })} /></div>
              <div className="form-field"><label>رقم السيارة</label><input value={saleForm.vehicle_number} onChange={(event) => setSaleForm({ ...saleForm, vehicle_number: event.target.value })} /></div>
              <div className="form-field"><label>المدفوع</label><input inputMode="decimal" value={saleForm.paid_amount} onChange={(event) => setSaleForm({ ...saleForm, paid_amount: event.target.value })} /></div>
              <div className="form-field"><label>المتبقي على الحساب</label><input readOnly value={money(saleRemaining)} /></div>
              <div className="form-actions"><Button type="submit">حفظ البيع</Button><Button type="button" variant="secondary" onClick={() => setSaleFormOpen(false)}>إلغاء</Button></div>
            </form>
          </div>
        )}
      </main>
    </PageLayout>
  );
}
