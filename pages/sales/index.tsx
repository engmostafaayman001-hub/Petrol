import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageLayout from "../../src/components/PageLayout";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../../src/components/DataState";
import {
  Button,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
} from "../../src/components/ui";
import { useRequireAuth } from "../../src/lib/auth";
import { useCurrentStationId } from "../../src/lib/station";
import supabase from "../../src/lib/supabaseClient";
import { formatMoney as formatMoneyValue, formatQuantity } from "../../src/core/numbers";
import { printDetails } from "../../src/lib/printDetails";

type Sale = {
  id: string;
  business_date?: string;
  created_at?: string;
  tank_code?: string;
  fuel_name?: string;
  quantity?: number;
  unit_price?: number;
  gross_amount?: number;
  paid_amount?: number;
  customer_name?: string;
  payment_method?: string;
  driver_name?: string;
  vehicle_number?: string;
  status?: string;
  created_by_name?: string;
  shift_code?: string;
};
type MeterSale = {
  id: string;
  business_date?: string;
  tank_code?: string;
  fuel_name?: string;
  shift_code?: string;
  opening_meter?: number;
  closing_meter?: number;
  meter_sold_qty?: number;
  sold_qty?: number;
  variance_qty?: number;
  session_status?: string;
};
type Session = { business_date?: string; shift_seq?: number; status?: string };
const money = (value: number) => formatMoneyValue(value);
const liters = (value: number) => formatQuantity(value, 3);
const shiftName = (seq?: number) =>
  seq === 1 ? "صباحية" : seq === 2 ? "مسائية" : "الوردية الحالية";
const saleStatus = (status?: string) =>
  status === "voided" ? "ملغاة" : "مسجلة";
export default function SalesList() {
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [rows, setRows] = useState<Sale[]>([]);
  const [meterSales, setMeterSales] = useState<MeterSale[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [fuel, setFuel] = useState("");
  const [selected, setSelected] = useState<Sale | null>(null);
  const [tab, setTab] = useState<"all" | "fuel" | "variance">("all");
  const load = useCallback(async () => {
    if (!stationId) return;
    setState("loading");
    try {
      const { data: auth } = await supabase.auth.getSession();
      const headers: Record<string, string> = auth.session?.access_token
        ? { Authorization: `Bearer ${auth.session.access_token}` }
        : {};
      const response = await fetch(
        `/api/sales/list?stationId=${encodeURIComponent(stationId)}`,
        { headers },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRows(data.sales || []);
      setMeterSales(data.meterSales || []);
      setSession(data.session || null);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [stationId]);
  useEffect(() => {
    load();
  }, [load]);
  const fuels = Array.from(
    new Set(rows.map((row) => row.fuel_name).filter(Boolean)),
  ) as string[];
  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!fuel || row.fuel_name === fuel) &&
          (!query ||
            [
              row.id,
              row.fuel_name,
              row.tank_code,
              row.customer_name,
              row.driver_name,
              row.vehicle_number,
            ].some((value) =>
              String(value || "")
                .toLowerCase()
                .includes(query.toLowerCase()),
            )),
      ),
    [rows, query, fuel],
  );
  const total = filtered.reduce(
    (sum, row) => sum + Number(row.gross_amount || 0),
    0,
  );
  const quantity = filtered.reduce(
    (sum, row) => sum + Number(row.quantity || 0),
    0,
  );
  const variance = meterSales.reduce(
    (sum, row) => sum + Math.max(Number(row.variance_qty || 0), 0),
    0,
  );
  const paidTotal = filtered.reduce(
    (sum, row) => sum + Number(row.paid_amount || 0),
    0,
  );
  const remainingTotal = Math.max(total - paidTotal, 0);
  return (
    <PageLayout title="المبيعات">
      <main dir="rtl">
        <PageHeader
          eyebrow="مركز المبيعات"
          title="المبيعات"
          description="إدارة ومتابعة مبيعات الوقود خلال الوردية الحالية."
          actions={
            <>
              <StatusBadge
                tone={session?.status === "open" ? "success" : "warning"}
              >
                {session
                  ? `الوردية ${shiftName(session.shift_seq)} · ${session.status === "open" ? "مفتوحة" : "مغلقة"}`
                  : "لا توجد وردية مفتوحة"}
              </StatusBadge>
              <Link className="ui-button" href="/sales/new">
                + إضافة عملية بيع
              </Link>
            </>
          }
        />
        {state === "loading" ? (
          <LoadingState />
        ) : state === "error" ? (
          <ErrorState onRetry={load} />
        ) : (
          <>
            <div className="stats-grid sales-stats">
              <StatCard
                label="إجمالي المبيعات"
                value={money(total)}
                tone="brand"
              />
              <StatCard
                label="إجمالي اللترات"
                value={liters(quantity)}
                tone="success"
              />
              <StatCard
                label="عدد العمليات"
                value={filtered.length}
                hint="في الوردية الحالية"
              />
              <StatCard
                label="إجمالي المدفوع"
                value={money(
                  paidTotal,
                )}
                tone="success"
              />
              <StatCard
                label="المتبقي"
                value={money(
                  remainingTotal,
                )}
                tone="warning"
              />
              <StatCard
                label="فرق العدادات"
                value={liters(variance)}
                hint="لا يحتسب كمبيعات"
                tone={variance ? "danger" : "success"}
              />
            </div>
            <SectionCard
              title="عمليات الوردية"
              description={
                session
                  ? `التاريخ: ${session.business_date} · البيانات مقيدة بالجلسة المفتوحة`
                  : "لا توجد جلسة مفتوحة حاليًا"
              }
            >
              <div className="sales-toolbar">
                <div className="sales-tabs">
                  <button
                    className={tab === "all" ? "active" : ""}
                    onClick={() => setTab("all")}
                  >
                    الكل
                  </button>
                  <button
                    className={tab === "fuel" ? "active" : ""}
                    onClick={() => setTab("fuel")}
                  >
                    وقود
                  </button>
                  <button
                    className={tab === "variance" ? "active" : ""}
                    onClick={() => setTab("variance")}
                  >
                    فرق العدادات
                  </button>
                </div>
                {tab !== "variance" && (
                  <div className="sales-filters">
                    <input
                      placeholder="بحث في المبيعات..."
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <select
                      value={fuel}
                      onChange={(event) => setFuel(event.target.value)}
                    >
                      <option value="">كل أنواع الوقود</option>
                      {fuels.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setQuery("");
                        setFuel("");
                      }}
                    >
                      إعادة ضبط
                    </Button>
                  </div>
                )}
              </div>
              {tab === "variance" ? (
                <VarianceTable rows={meterSales} />
              ) : filtered.length ? (
                <div className="table-scroll">
                  <table className="data-table sales-table">
                    <thead>
                      <tr>
                        <th>التاريخ والوقت</th>
                        <th>الوقود / الخزان</th>
                        <th>العميل</th>
                        <th>السائق / السيارة</th>
                        <th>الكمية</th>
                        <th>سعر الوحدة</th>
                        <th>الإجمالي</th>
                        <th>المدفوع</th>
                        <th>المتبقي</th>
                        <th>الحالة</th>
                        <th>التفاصيل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row) => (
                        <tr key={row.id} onClick={() => setSelected(row)}>
                          <td>
                            {row.business_date || "—"}
                            <small className="block">
                              {row.created_at
                                ? new Date(row.created_at).toLocaleTimeString(
                                    "ar-EG",
                                  )
                                : "—"}
                            </small>
                          </td>
                          <td>
                            <b>{row.fuel_name || "—"}</b>
                            <small className="block">
                              {row.tank_code || "—"}
                            </small>
                          </td>
                          <td>{row.customer_name || "عميل نقدي"}</td>
                          <td>{[row.driver_name, row.vehicle_number].filter(Boolean).join(" / ") || "—"}</td>
                          <td>{liters(row.quantity || 0)}</td>
                          <td>{money(row.unit_price || 0)}</td>
                          <td>
                            <b>{money(row.gross_amount || 0)}</b>
                          </td>
                          <td>{money(row.paid_amount || 0)}</td>
                          <td>{money(Math.max(Number(row.gross_amount || 0) - Number(row.paid_amount || 0), 0))}</td>
                          <td>
                            <StatusBadge
                              tone={
                                row.status === "voided" ? "danger" : "success"
                              }
                            >
                              {saleStatus(row.status)}
                            </StatusBadge>
                          </td>
                          <td>
                            <button
                              className="ui-button secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelected(row);
                              }}
                            >
                              عرض
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="لا توجد مبيعات"
                  description="لم يتم تسجيل أي عملية بيع في الوردية الحالية."
                />
              )}
            </SectionCard>
            <SectionCard
              title="خصومات فرق العدادات"
              description="تُضاف تلقائيًا عند إغلاق الوردية، وتؤثر على المخزون دون احتسابها كمبيعات أو إيراد."
            >
              <VarianceTable
                rows={meterSales.filter(
                  (row) => Number(row.variance_qty || 0) !== 0,
                )}
              />
            </SectionCard>
          </>
        )}
      </main>
      {selected && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onMouseDown={() => setSelected(null)}
        >
          <section
            className="ui-card modal-card"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="section-card-header">
              <div>
                <h3>تفاصيل عملية البيع</h3>
                <p>
                  {selected.fuel_name || "وقود"} · {selected.tank_code || "—"}
                </p>
              </div>
              <div className="no-print flex gap-2">
                <button type="button" className="ui-button secondary" onClick={printDetails}>طباعة</button>
                <button className="modal-close" onClick={() => setSelected(null)}>×</button>
              </div>
            </header>
            <dl className="expense-details">
              <div>
                <dt>رقم العملية</dt>
                <dd>{selected.id}</dd>
              </div>
              <div>
                <dt>التاريخ والوقت</dt>
                <dd>
                  {selected.business_date || "—"} ·{" "}
                  {selected.created_at
                    ? new Date(selected.created_at).toLocaleTimeString("ar-EG")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>العميل</dt>
                <dd>{selected.customer_name || "عميل نقدي"}</dd>
              </div>
              <div>
                <dt>السائق / السيارة</dt>
                <dd>
                  {selected.driver_name || "—"} /{" "}
                  {selected.vehicle_number || "—"}
                </dd>
              </div>
              <div>
                <dt>الكمية</dt>
                <dd>{liters(selected.quantity || 0)}</dd>
              </div>
              <div>
                <dt>سعر الوحدة</dt>
                <dd>{money(selected.unit_price || 0)}</dd>
              </div>
              <div>
                <dt>الإجمالي</dt>
                <dd>{money(selected.gross_amount || 0)}</dd>
              </div>
              <div>
                <dt>المدفوع</dt>
                <dd>{money(selected.paid_amount || 0)}</dd>
              </div>
              <div>
                <dt>المتبقي</dt>
                <dd>
                  {money(
                    Math.max(
                      Number(selected.gross_amount || 0) -
                        Number(selected.paid_amount || 0),
                      0,
                    ),
                  )}
                </dd>
              </div>
              <div>
                <dt>طريقة الدفع</dt>
                <dd>{selected.payment_method || "—"}</dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </PageLayout>
  );
}
function VarianceTable({ rows }: { rows: MeterSale[] }) {
  return rows.length ? (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>التاريخ</th>
            <th>الوقود / الخزان</th>
            <th>الوردية</th>
            <th>قراءة البداية</th>
            <th>قراءة النهاية</th>
            <th>كمية العداد</th>
            <th>فرق المطابقة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.business_date || "—"}</td>
              <td>
                {row.fuel_name || "—"} · {row.tank_code || "—"}
              </td>
              <td>{row.shift_code || "—"}</td>
              <td>{Number(row.opening_meter || 0).toLocaleString("ar-EG")}</td>
              <td>{Number(row.closing_meter || 0).toLocaleString("ar-EG")}</td>
              <td>{liters(row.meter_sold_qty || 0)}</td>
              <td>{liters(row.variance_qty || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <EmptyState
      title="لا توجد قراءات عدادات مكتملة"
      description="تظهر بعد حفظ قراءة نهاية العداد."
    />
  );
}
