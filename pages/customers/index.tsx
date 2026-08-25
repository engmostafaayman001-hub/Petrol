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
type InternalTransaction = {
  id: string;
  transaction_type: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  subtotal: number;
  discount: number;
  total: number;
  paid_amount: number;
  remaining: number;
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
  const [internalTransactions, setInternalTransactions] = useState<InternalTransaction[]>([]);
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
  const [internalFormOpen, setInternalFormOpen] = useState(false);
  const [editingInternal, setEditingInternal] = useState<InternalTransaction | null>(null);
  const [internalForm, setInternalForm] = useState({ transaction_type: "purchase", description: "", quantity: "", unit: "وحدة", unit_price: "", discount: "", paid_amount: "", business_date: new Date().toISOString().slice(0, 10), notes: "" });
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
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
    setForm({ name: "", phone: "", email: "", address: "", notes: "" });
    setFormOpen(false);
    load();
  }
  function edit(customer: Customer) {
    setEditing(customer);
    setForm({ name: customer.name, phone: customer.phone || "", email: customer.email || "", address: customer.address || "", notes: "" });
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
      const internalResponse = await fetch(`/api/customers/transactions?stationId=${encodeURIComponent(stationId || "")}&customerId=${customer.id}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const internalData = await internalResponse.json();
      setInternalTransactions(internalResponse.ok ? internalData.transactions || [] : []);
    }
  }
  const internalTotals = internalTransactions.reduce((totals, item) => ({ total: totals.total + Number(item.total || 0), paid: totals.paid + Number(item.paid_amount || 0), remaining: totals.remaining + Number(item.remaining || 0) }), { total: 0, paid: 0, remaining: 0 });
  const internalSubtotal = (parseNumericInput(internalForm.quantity) || 0) * (parseNumericInput(internalForm.unit_price) || 0);
  const internalTotal = Math.max(internalSubtotal - (parseNumericInput(internalForm.discount) || 0), 0);
  function openInternalForm(item?: InternalTransaction) {
    setEditingInternal(item || null);
    setInternalForm(item ? { transaction_type: item.transaction_type, description: item.description, quantity: String(item.quantity), unit: item.unit, unit_price: String(item.unit_price), discount: String(item.discount), paid_amount: String(item.paid_amount), business_date: item.business_date, notes: item.notes || "" } : { transaction_type: "purchase", description: "", quantity: "", unit: "وحدة", unit_price: "", discount: "", paid_amount: "", business_date: new Date().toISOString().slice(0, 10), notes: "" });
    setInternalFormOpen(true);
  }
  async function saveInternal(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const method = editingInternal ? "PATCH" : "POST";
    const response = await fetch(`/api/customers/transactions?stationId=${encodeURIComponent(stationId || "")}&customerId=${selected.id}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ ...internalForm, id: editingInternal?.id }) });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "تعذر حفظ العملية الداخلية.");
    setInternalFormOpen(false);
    setEditingInternal(null);
    setMessage("تم حفظ العملية الداخلية.");
    view(selected);
  }
  async function removeInternal(item: InternalTransaction) {
    if (!selected || !window.confirm("هل أنت متأكد من حذف العملية الداخلية؟ لن يؤثر ذلك على الوقود أو المخزون.")) return;
    const response = await fetch(`/api/customers/transactions?stationId=${encodeURIComponent(stationId || "")}&customerId=${selected.id}`, { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ id: item.id }) });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "تعذر حذف العملية.");
    setMessage("تم حذف العملية الداخلية.");
    view(selected);
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
              <strong>الحساب المالي الموحد</strong>
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
                  <button type="button" className="ui-button secondary" onClick={printDetails}>طباعة</button>
                  <button className="modal-close" onClick={() => setSelected(null)}>×</button>
                </div>
              </header>
              <div className="account-summary-grid">
                <div><span>عدد العمليات</span><b>{summary.operations}</b></div>
                <div><span>إجمالي المبيعات</span><b>{money(summary.total_sales)}</b></div>
                <div><span>إجمالي المدفوع</span><b>{money(summary.total_paid)}</b></div>
                <div><span>المتبقي للتحصيل</span><b>{money(summary.total_due)}</b></div>
                <div><span>إجمالي العمليات الداخلية</span><b>{money(internalTotals.total)}</b></div>
                <div><span>مدفوع العمليات الداخلية</span><b>{money(internalTotals.paid)}</b></div>
                <div><span>متبقي العمليات الداخلية</span><b>{money(internalTotals.remaining)}</b></div>
              </div>
              <div className="flex justify-between items-center gap-3 mb-3"><h4>العمليات الداخلية</h4>{isManager && <Button onClick={() => openInternalForm()}>+ إضافة عملية داخلية</Button>}</div>
              <div className="table-scroll"><table className="data-table"><thead><tr><th>التاريخ</th><th>الوصف</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th>{isManager && <th>إجراءات</th>}</tr></thead><tbody>{internalTransactions.map((item) => <tr key={item.id}><td>{item.business_date}</td><td>{item.description}</td><td>{Number(item.quantity).toLocaleString("ar-EG")} {item.unit}</td><td>{money(item.unit_price)}</td><td>{money(item.discount)}</td><td>{money(item.total)}</td><td>{money(item.paid_amount)}</td><td>{money(item.remaining)}</td>{isManager && <td><button className="ui-button secondary" onClick={() => openInternalForm(item)}>تعديل</button> <button className="ui-button danger" onClick={() => removeInternal(item)}>حذف</button></td>}</tr>)}</tbody></table></div>
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
        {internalFormOpen && selected && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <form className="ui-card form-card modal-card form-grid" onSubmit={saveInternal}>
              <h3>{editingInternal ? "تعديل عملية داخلية" : "إضافة عملية داخلية"}</h3>
              <div className="form-field"><label>نوع العملية</label><select value={internalForm.transaction_type} onChange={(event) => setInternalForm({ ...internalForm, transaction_type: event.target.value })}><option value="purchase">شراء داخلي</option><option value="service">خدمة</option><option value="other">عملية حسابية</option></select></div>
              <div className="form-field"><label>الوصف</label><input required value={internalForm.description} onChange={(event) => setInternalForm({ ...internalForm, description: event.target.value })} /></div>
              <div className="form-field"><label>الكمية</label><input type="text" inputMode="decimal" value={internalForm.quantity} onChange={(event) => setInternalForm({ ...internalForm, quantity: event.target.value })} /></div>
              <div className="form-field"><label>الوحدة</label><input value={internalForm.unit} onChange={(event) => setInternalForm({ ...internalForm, unit: event.target.value })} /></div>
              <div className="form-field"><label>السعر</label><input required type="text" inputMode="decimal" value={internalForm.unit_price} onChange={(event) => setInternalForm({ ...internalForm, unit_price: event.target.value })} /></div>
              <div className="form-field"><label>الخصم</label><input type="text" inputMode="decimal" value={internalForm.discount} onChange={(event) => setInternalForm({ ...internalForm, discount: event.target.value })} /></div>
              <div className="form-field"><label>الإجمالي قبل الخصم</label><input readOnly value={money(internalSubtotal)} /></div>
              <div className="form-field"><label>الإجمالي النهائي</label><input readOnly value={money(internalTotal)} /></div>
              <div className="form-field"><label>المدفوع</label><input type="text" inputMode="decimal" value={internalForm.paid_amount} onChange={(event) => setInternalForm({ ...internalForm, paid_amount: event.target.value })} /></div>
              <div className="form-field"><label>المتبقي</label><input readOnly value={money(Math.max(internalTotal - (parseNumericInput(internalForm.paid_amount) || 0), 0))} /></div>
              <div className="form-field"><label>التاريخ</label><input type="date" value={internalForm.business_date} onChange={(event) => setInternalForm({ ...internalForm, business_date: event.target.value })} /></div>
              <div className="form-field form-field-full"><label>ملاحظات</label><textarea value={internalForm.notes} onChange={(event) => setInternalForm({ ...internalForm, notes: event.target.value })} /></div>
              <div className="form-actions"><Button type="submit">حفظ العملية</Button><Button type="button" variant="secondary" onClick={() => setInternalFormOpen(false)}>إلغاء</Button></div>
            </form>
          </div>
        )}
      </main>
    </PageLayout>
  );
}
