import React, { useEffect, useState } from "react";
import PageLayout from "../../src/components/PageLayout";
import {
  Button,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../../src/components/ui";
import { useRequireAuth } from "../../src/lib/auth";
import { useCurrentStationId } from "../../src/lib/station";
import supabase from "../../src/lib/supabaseClient";
import { formatMoney as formatMoneyValue, parseNumericInput } from "../../src/core/numbers";
import { printDetails } from "../../src/lib/printDetails";

type Supplier = {
  id: string;
  code: string;
  name: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
};
type Transaction = {
  id: string;
  transaction_type: string;
  debit: number;
  credit: number;
  business_date: string;
};
const money = (value: number) => formatMoneyValue(value);
export default function SuppliersPage() {
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [balance, setBalance] = useState(0);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    code: "",
    contact_name: "",
    contact_phone: "",
    notes: "",
  });
  const [message, setMessage] = useState("");
  async function token() {
    return (await supabase.auth.getSession()).data.session?.access_token || "";
  }
  async function load() {
    if (!stationId) return;
    const response = await fetch(
      `/api/suppliers?stationId=${encodeURIComponent(stationId)}`,
      { headers: { Authorization: `Bearer ${await token()}` } },
    );
    const data = await response.json();
    if (response.ok) setSuppliers(data.suppliers || []);
  }
  useEffect(() => {
    load();
  }, [stationId]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/suppliers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await token()}`,
      },
      body: JSON.stringify({ station_id: stationId, ...form }),
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error);
    setMessage("تم حفظ المورد.");
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
  return (
    <PageLayout title="الموردون">
      <main className="accounts-page" dir="rtl">
        <PageHeader
          eyebrow="الحسابات"
          title="الموردون"
          description="حساب موحد لكل مورد مع حركة التوريدات والمدفوعات."
          actions={
            <Button onClick={() => setFormOpen(true)}>إضافة مورد</Button>
          }
        />
        {message && <p className="form-error">{message}</p>}
        <div className="account-cards">
          {suppliers.map((supplier) => (
            <article className="account-card" key={supplier.id}>
              <header>
                <div>
                  <h3>{supplier.name}</h3>
                  <small>{supplier.contact_phone || supplier.code}</small>
                </div>
                <StatusBadge tone="info">مورد</StatusBadge>
              </header>
              <strong>حساب المورد</strong>
              <button
                className="ui-button secondary"
                onClick={() => view(supplier)}
              >
                عرض التفاصيل
              </button>
            </article>
          ))}
        </div>
        {formOpen && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <form
              className="ui-card form-card modal-card form-grid"
              onSubmit={save}
            >
              <h3>إضافة مورد</h3>
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
                  <p>الدين الحالي: {money(balance)}</p>
                </div>
                <div className="no-print flex gap-2">
                  <button type="button" className="ui-button secondary" onClick={printDetails}>طباعة</button>
                  <button className="modal-close" onClick={() => setSelected(null)}>×</button>
                </div>
              </header>
              <div className="account-ledger">
                {transactions.length ? (
                  transactions.map((entry) => (
                    <div key={entry.id}>
                      <span>
                        {entry.business_date} · {entry.transaction_type}
                      </span>
                      <b>{money(entry.credit - entry.debit)}</b>
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
