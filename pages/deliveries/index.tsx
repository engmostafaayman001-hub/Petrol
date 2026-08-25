import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageLayout from "../../src/components/PageLayout";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../../src/components/DataState";
import { useRequireAuth, useRole } from "../../src/lib/auth";
import { useCurrentStationId } from "../../src/lib/station";
import supabase from "../../src/lib/supabaseClient";
import { printDetails } from "../../src/lib/printDetails";
import { formatPrice } from "../../src/core/numbers";
type Delivery = {
  id: string;
  business_date?: string;
  tank_code?: string;
  fuel_name?: string;
  supplier_name?: string;
  quantity?: number;
  total_cost?: number;
};
export default function DeliveriesList() {
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const { role } = useRole();
  const isManager = role === "manager";
  const [rows, setRows] = useState<any[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState("");
  const [selected, setSelected] = useState<any>(null);
  async function manageDelivery(row: any, method: "PATCH" | "DELETE") {
    const reason = window.prompt(method === "DELETE" ? "سبب حذف/إلغاء التوريد:" : "سبب تعديل التوريد:", "تصحيح إداري");
    if (!reason) return;
    let payload: Record<string, unknown> | undefined;
    if (method === "PATCH") {
      const quantity = window.prompt("الكمية الجديدة:", String(row.quantity || ""));
      const unitCost = window.prompt("سعر الوحدة الجديد:", String(row.unit_cost || ""));
      if (!quantity || !unitCost) return;
      payload = { quantity: Number(quantity), unit_cost: Number(unitCost), supplier_id: row.supplier_id, tank_id: row.tank_id, fuel_type_id: row.fuel_type_id, reference_no: row.reference_no, notes: row.notes };
    }
    const response = await fetch(`/api/deliveries/manage?id=${encodeURIComponent(row.id)}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ""}` }, body: JSON.stringify({ reason, payload }) });
    const data = await response.json();
    if (!response.ok) window.alert(data.error || "تعذر تنفيذ العملية."); else await load();
  }
  const load = useCallback(async () => {
    if (!stationId) return;
    setState("loading");
    try {
      const { data: auth } = await supabase.auth.getSession();
      const headers: Record<string, string> = auth.session?.access_token
        ? { Authorization: `Bearer ${auth.session.access_token}` }
        : {};
      const r = await fetch(
        `/api/deliveries/list?stationId=${encodeURIComponent(stationId)}`,
        { headers },
      );
      if (!r.ok) throw new Error();
      const d = await r.json();
      setRows(d.deliveries || []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [stationId]);
  useEffect(() => {
    if (stationId) load();
  }, [stationId, load]);
  const suppliers = Array.from(
    new Map(
      rows
        .filter((row) => row.supplier_id)
        .map((row) => [
          row.supplier_id,
          { id: row.supplier_id, name: row.supplier_name },
        ]),
    ).values(),
  );
  const filtered = rows.filter(
    (row) =>
      (!supplier || row.supplier_id === supplier) &&
      (!query ||
        [
          row.id,
          row.reference_no,
          row.supplier_name,
          row.fuel_name,
          row.tank_code,
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(query.toLowerCase()),
        )),
  );
  return (
    <PageLayout title="التوريدات">
      <div className="page-heading">
        <div>
          <h2>سجل التوريدات</h2>
          <p>كل توريد مرتبط بالمورد المحفوظ عبر supplier_id.</p>
        </div>
        <Link className="ui-button" href="/deliveries/new">
          تسجيل توريد
        </Link>
      </div>
      <section className="ui-card">
        <div className="ui-toolbar delivery-filters">
          <input
            placeholder="بحث برقم التوريد أو المورد أو الخزان"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          >
            <option value="">كل الموردين</option>
            {suppliers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            className="ui-button ghost"
            onClick={() => {
              setQuery("");
              setSupplier("");
            }}
          >
            إعادة تعيين
          </button>
          <span className="status-badge">{filtered.length} عملية</span>
        </div>
        {state === "loading" ? (
          <LoadingState />
        ) : state === "error" ? (
          <ErrorState onRetry={load} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="لا توجد توريدات مسجلة"
            description="غيّر الفلاتر أو سجل أول توريد."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>رقم العملية</th>
                  <th>التاريخ</th>
                  <th>المورد</th>
                  <th>الوقود</th>
                  <th>الخزان</th>
                  <th>الكمية</th>
                  <th>سعر الوحدة</th>
                  <th>الإجمالي</th>
                  <th>المدفوع</th>
                  <th>المتبقي</th>
                  <th>التفاصيل</th>
                  {isManager && <th>إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const total = Number(row.total_cost || 0);
                  const paid = Number(row.paid_amount || 0);
                  return (
                    <tr key={row.id}>
                      <td>{row.reference_no || row.id.slice(0, 8)}</td>
                      <td>{row.business_date || "—"}</td>
                      <td>
                        <b>{row.supplier_name || "غير مرتبط"}</b>
                      </td>
                      {isManager && <td><button className="ui-button secondary" onClick={() => manageDelivery(row, "PATCH")}>تعديل</button> <button className="ui-button danger" onClick={() => manageDelivery(row, "DELETE")}>إلغاء</button></td>}
                      <td>{row.fuel_name || "—"}</td>
                      <td>{row.tank_code || "—"}</td>
                      <td>
                        {Number(row.quantity || 0).toLocaleString("ar-EG")} لتر
                      </td>
                      <td>{formatPrice(row.unit_cost || 0, false)}</td>
                      <td>{total.toLocaleString("ar-EG")} ج.م</td>
                      <td>{paid.toLocaleString("ar-EG")} ج.م</td>
                      <td>
                        {Math.max(total - paid, 0).toLocaleString("ar-EG")} ج.م
                      </td>
                      <td>
                        <button
                          className="ui-button secondary"
                          onClick={() => setSelected(row)}
                        >
                          عرض
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onMouseDown={() => setSelected(null)}
        >
          <section
            className="ui-card modal-card"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="section-card-header">
              <div>
                <h3>تفاصيل التوريد</h3>
                <p>{selected.supplier_name || "مورد غير مرتبط"}</p>
              </div>
              <div className="no-print flex gap-2">
                <button type="button" className="ui-button secondary" onClick={printDetails}>طباعة</button>
                <button className="modal-close" onClick={() => setSelected(null)}>×</button>
              </div>
            </header>
            <dl className="expense-details">
              <div>
                <dt>المورد</dt>
                <dd>{selected.supplier_name || "—"}</dd>
              </div>
              <div>
                <dt>نوع الوقود</dt>
                <dd>{selected.fuel_name || "—"}</dd>
              </div>
              <div>
                <dt>الخزان</dt>
                <dd>{selected.tank_code || "—"}</dd>
              </div>
              <div>
                <dt>الكمية</dt>
                <dd>
                  {Number(selected.quantity || 0).toLocaleString("ar-EG")} لتر
                </dd>
              </div>
              <div>
                <dt>السعر</dt>
                <dd>
                  {formatPrice(selected.unit_cost || 0)}
                </dd>
              </div>
              <div>
                <dt>الإجمالي</dt>
                <dd>
                  {Number(selected.total_cost || 0).toLocaleString("ar-EG")} ج.م
                </dd>
              </div>
              <div>
                <dt>المدفوع</dt>
                <dd className="text-emerald-700">
                  {Number(selected.paid_amount || 0).toLocaleString("ar-EG")} ج.م
                </dd>
              </div>
              <div>
                <dt>المتبقي</dt>
                <dd className={Math.max(Number(selected.total_cost || 0) - Number(selected.paid_amount || 0), 0) > 0 ? "text-amber-700" : "text-emerald-700"}>
                  {Math.max(Number(selected.total_cost || 0) - Number(selected.paid_amount || 0), 0).toLocaleString("ar-EG")} ج.م
                </dd>
              </div>
              <div>
                <dt>رقم الفاتورة</dt>
                <dd>{selected.reference_no || "—"}</dd>
              </div>
              <div>
                <dt>الملاحظات</dt>
                <dd>{selected.notes || "—"}</dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </PageLayout>
  );
}
