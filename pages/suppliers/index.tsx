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

type Supplier = {
  id: string;
  code: string;
  name: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
  supply_count?: number;
  total_supplies?: number;
  total_paid?: number;
  total_due?: number;
  fuel_breakdown?: Array<{ name: string; code?: string | null; quantity: number }>;
};
type Transaction = {
  id: string;
  transaction_type: string;
  debit: number;
  credit: number;
  business_date: string;
  reference_id?: string | null;
};
type SupplierSummary = {
  operations: number;
  total_supplies: number;
  total_paid: number;
  total_due: number;
};
const money = (value: number) => formatMoneyValue(value);
const transactionLabel = (type: string) => ({
  delivery: "توريد آجل",
  supplier_payment: "دفعة للمورد",
  adjustment: "تسوية حساب",
}[type] || "حركة حساب");
export default function SuppliersPage() {
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const { role } = useRole();
  const canManageAccounts = role === "manager" || role === "supervisor";
  const isManager = role === "manager";
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [balance, setBalance] = useState(0);
  const [summary, setSummary] = useState<SupplierSummary>({ operations: 0, total_supplies: 0, total_paid: 0, total_due: 0 });
  const [paymentAmount, setPaymentAmount] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState({
    name: "",
    code: "",
    contact_name: "",
    contact_phone: "",
    notes: "",
  });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  async function token() {
    return (await supabase.auth.getSession()).data.session?.access_token || "";
  }
  async function load() {
    if (!stationId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/suppliers?stationId=${encodeURIComponent(stationId)}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const data = await response.json();
      if (response.ok) setSuppliers(data.suppliers || []); else setMessage(data.error || "تعذر تحميل الموردين.");
    } finally { setLoading(false); }
  }
  useEffect(() => {
    load();
  }, [stationId]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/suppliers", {
      method: editing ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await token()}`,
      },
      body: JSON.stringify({ station_id: stationId, id: editing?.id, ...form }),
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error);
    setMessage(editing ? "تم تعديل المورد." : "تم حفظ المورد.");
    setEditing(null);
    setForm({
      name: "",
      code: "",
      contact_name: "",
      contact_phone: "",
      notes: "",
    });
    setFormOpen(false);
    load();
  }
  function edit(supplier: Supplier) {
    if (!canManageAccounts) return;
    setEditing(supplier);
    setForm({ name: supplier.name, code: supplier.code, contact_name: supplier.contact_name || "", contact_phone: supplier.contact_phone || "", notes: supplier.notes || "" });
    setFormOpen(true);
  }
  async function remove(supplier: Supplier) {
    if (!isManager) return;
    if (!window.confirm("هل أنت متأكد من حذف هذا المورد نهائيًا؟ لا يمكن حذفه إذا كان مرتبطًا بتوريدات أو مدفوعات.")) return;
    const response = await fetch("/api/suppliers", { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ station_id: stationId, id: supplier.id }) });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "تعذر تعطيل المورد.");
    setMessage("تم حذف المورد نهائيًا.");
    if (selected?.id === supplier.id) setSelected(null);
    load();
  }
  async function view(supplier: Supplier) {
    const response = await fetch(
      `/api/suppliers?stationId=${encodeURIComponent(stationId || "")}&supplierId=${supplier.id}`,
      { headers: { Authorization: `Bearer ${await token()}` } },
    );
    const data = await response.json();
    if (response.ok) {
      setSelected(supplier);
      setTransactions(data.transactions || []);
      setBalance(Number(data.balance || 0));
      setSummary(data.summary || { operations: 0, total_supplies: 0, total_paid: 0, total_due: Number(data.balance || 0) });
    }
  }
  async function pay() {
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
        account_type: "supplier",
        supplier_id: selected.id,
        amount,
        payment_method: "نقدي",
      }),
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error);
    setPaymentAmount("");
    setBalance(Number(data.balance));
    setMessage("تم تسجيل الدفع للمورد.");
    view(selected);
  }
  async function manageAccountEntry(entry: Transaction, action: 'edit' | 'delete') {
    if (!isManager || !selected) return;
    const isPayment = entry.transaction_type === 'supplier_payment';
    const sourceId = entry.reference_id;
    if (!isPayment && (entry.transaction_type !== 'delivery' || !sourceId)) return setMessage('لا يمكن تعديل هذه الحركة من كشف الحساب.');
    if (action === 'delete' && !window.confirm('هل تريد إلغاء هذه الحركة؟')) return;
    let response: Response;
    if (isPayment) {
      const amount = action === 'edit' ? window.prompt('مبلغ الدفعة الجديد', String(entry.debit || 0)) : null;
      if (action === 'edit' && (!amount || Number(amount) <= 0)) return;
      response = await fetch(`/api/accounts/payment?id=${encodeURIComponent(entry.id)}&stationId=${encodeURIComponent(stationId || '')}`, { method: action === 'edit' ? 'PATCH' : 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: action === 'edit' ? JSON.stringify({ station_id: stationId, amount }) : JSON.stringify({ station_id: stationId }) });
    } else {
      const quantity = action === 'edit' ? window.prompt('كمية التوريد الجديدة باللتر') : null;
      const reason = window.prompt('سبب التعديل أو الإلغاء') || '';
      if (action === 'edit' && (!quantity || Number(quantity) <= 0)) return;
      response = await fetch(`/api/deliveries/manage?id=${encodeURIComponent(sourceId || '')}`, { method: action === 'edit' ? 'PATCH' : 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify(action === 'edit' ? { reason, payload: { quantity: Number(quantity) } } : { reason }) });
    }
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || 'تعذر تعديل حركة الحساب.');
    setMessage(action === 'edit' ? 'تم تعديل الحركة.' : 'تم إلغاء الحركة.');
    view(selected);
  }
  return (
    <PageLayout title="الموردون">
      <main className="accounts-page" dir="rtl">
        <PageHeader
          eyebrow="الحسابات"
          title="الموردون"
          description="حساب موحد لكل مورد مع حركة التوريدات والمدفوعات."
          actions={canManageAccounts ? <Button onClick={() => setFormOpen(true)}>إضافة مورد</Button> : undefined}
        />
        {message && <p className="form-error">{message}</p>}
        {loading ? <LoadingState /> : <div className="account-cards">
          {suppliers.map((supplier) => (
            <article className="account-card" key={supplier.id}>
              <header>
                <div>
                  <h3>{supplier.name}</h3>
                  <small>{supplier.contact_phone || supplier.code}</small>
                </div>
                <StatusBadge tone="info">مورد</StatusBadge>
              </header>
              <div className="account-summary-grid">
                <div><span>عدد التوريدات</span><b>{supplier.supply_count || 0}</b></div>
                <div><span>إجمالي التوريد</span><b>{money(Number(supplier.total_supplies || 0))}</b></div>
                <div><span>المدفوع</span><b>{money(Number(supplier.total_paid || 0))}</b></div>
                <div><span>المتبقي</span><b>{money(Number(supplier.total_due || 0))}</b></div>
              </div>
              <div className="text-sm text-[var(--text-muted)]">
                <span className="block mb-1">أنواع الوقود الموردة</span>
                {supplier.fuel_breakdown?.length ? <div className="flex flex-wrap gap-2">{supplier.fuel_breakdown.map((fuel) => <span key={`${fuel.name}-${fuel.code || ''}`} className="status-badge">{fuel.name}{fuel.code ? ` (${fuel.code})` : ''}: {Number(fuel.quantity || 0).toLocaleString('ar-EG')} لتر</span>)}</div> : <span>لا توجد توريدات مسجلة بعد.</span>}
              </div>
              <div className="flex gap-2 flex-wrap">
              <button
                className="ui-button secondary"
                onClick={() => view(supplier)}
              >
                عرض التفاصيل
              </button>
              {canManageAccounts && <button className="ui-button secondary" onClick={() => edit(supplier)}>تعديل</button>}{isManager && <button className="ui-button danger" onClick={() => remove(supplier)}>حذف</button>}
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
              <h3>{editing ? "تعديل المورد" : "إضافة مورد"}</h3>
              <div className="form-field">
                <label>اسم المورد</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label>كود المورد</label>
                <input
                  required
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label>اسم جهة الاتصال</label>
                <input
                  value={form.contact_name}
                  onChange={(e) =>
                    setForm({ ...form, contact_name: e.target.value })
                  }
                />
              </div>
              <div className="form-field">
                <label>الهاتف</label>
                <input
                  value={form.contact_phone}
                  onChange={(e) =>
                    setForm({ ...form, contact_phone: e.target.value })
                  }
                />
              </div>
              <div className="form-field">
                <label>ملاحظات</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
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
                  <p>المتبقي للسداد: {money(summary.total_due)}</p>
                </div>
                <div className="no-print flex gap-2">
                  <button type="button" className="ui-button secondary" onClick={printDetails}>طباعة</button>
                  <button className="modal-close" onClick={() => setSelected(null)}>×</button>
                </div>
              </header>
              <div className="account-summary-grid">
                <div><span>عدد التوريدات</span><b>{summary.operations}</b></div>
                <div><span>إجمالي التوريد</span><b>{money(summary.total_supplies)}</b></div>
                <div><span>إجمالي المدفوع</span><b>{money(summary.total_paid)}</b></div>
                <div><span>المتبقي للسداد</span><b>{money(summary.total_due)}</b></div>
              </div>
              <div className="account-ledger">
                {transactions.length ? (
                  transactions.map((entry) => (
                    <div key={entry.id}>
                      <span>
                        {entry.business_date} · {transactionLabel(entry.transaction_type)}
                      </span>
                      <span className="flex items-center gap-2"><b>{money(entry.credit - entry.debit)}</b>{isManager && ['delivery', 'supplier_payment'].includes(entry.transaction_type) && <><button type="button" className="text-blue-700" onClick={() => manageAccountEntry(entry, 'edit')}>تعديل</button><button type="button" className="text-red-700" onClick={() => manageAccountEntry(entry, 'delete')}>حذف</button></>}</span>
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
                    placeholder="مبلغ الدفع"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                  />
                  <Button onClick={pay}>دفع للمورد</Button>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </PageLayout>
  );
}
