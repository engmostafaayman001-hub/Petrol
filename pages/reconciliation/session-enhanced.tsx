import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import PageLayout from "../../src/components/PageLayout";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../../src/components/DataState";
import { useRequireAuth, useRole } from "../../src/lib/auth";
import { SkeletonLoader, SkeletonCard } from "../../src/components/SkeletonLoader";
import { FormModal } from "../../src/components/AdminUI";
import supabase from "../../src/lib/supabaseClient";
import { shiftLabel } from "../../src/lib/displayLabels";
import { formatMoney as formatMoneyValue, formatQuantity } from "../../src/core/numbers";

const messageFrom = (data: any, fallback: string) =>
  data?.error || data?.message || data?.hint || fallback;
const money = (value: number) => formatMoneyValue(value);

export default function SessionPage() {
  const router = useRouter();
  const { user } = useRequireAuth();
  const { role } = useRole();
  const sessionId =
    typeof router.query.sessionId === "string" ? router.query.sessionId : "";

  const [session, setSession] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closeNotes, setCloseNotes] = useState("");
  const [closingReadings, setClosingReadings] = useState<Record<string, number>>({});

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token
      ? { Authorization: `Bearer ${data.session.access_token}` }
      : {};
  }, []);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(
        `/api/reconciliation/detail?sessionId=${encodeURIComponent(sessionId)}`,
        { headers: await authHeaders() }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(messageFrom(data, "تعذر تحميل تفاصيل الجلسة."));
      
      setSession({ ...data.session, operations: data.operations || [] });
      setLines(data.lines || []);
      
      // Initialize closing readings from existing data
      const initialReadings: Record<string, number> = {};
      (data.lines || []).forEach((line: any) => {
        const readings = line.meter_readings?.length ? line.meter_readings : [
          line.meter_id && { meter_id: line.meter_id, reading_number: 1, closing_reading: line.closing_meter },
          line.meter2_id && { meter_id: line.meter2_id, reading_number: 2, closing_reading: line.closing_meter2 },
        ].filter(Boolean);
        readings.forEach((reading: any) => {
          if (reading.closing_reading != null) {
            initialReadings[reading.meter_id] = reading.closing_reading;
          }
        });
      });
      setClosingReadings(initialReadings);
    } catch (error: any) {
      setLoadError(error.message || "تعذر الاتصال بالخادم.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCloseShift() {
    if (!session?.id) return setMessage("معرّف الجلسة غير صالح.");

    const missing = lines.flatMap((line) => {
      const readings = line.meter_readings?.length ? line.meter_readings : [
        line.meter_id && { reading_number: 1, opening_reading: line.opening_meter, closing_reading: line.closing_meter },
        line.meter2_id && { reading_number: 2, opening_reading: line.opening_meter2, closing_reading: line.closing_meter2 },
      ].filter(Boolean);
      return readings.filter((reading: any) => reading.opening_reading == null || reading.closing_reading == null).map((reading: any) => `${line.tank_code || line.fuel_name || "خزان غير معروف"} يحتاج قراءة العداد رقم ${reading.reading_number}`);
    });

    if (missing.length) {
      return setMessage(
        `أدخل قراءتي النهاية للعدادات التالية: ${missing.join("، ")}`
      );
    }

    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/reconciliation/close", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeaders()),
        },
        body: JSON.stringify({
          session_id: session.id,
          closing_readings: closingReadings,
          notes: closeNotes || null,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(messageFrom(data, "تعذر إغلاق الوردية."));
      }

      setMessage("تم إغلاق الوردية بنجاح.");
      setShowCloseConfirm(false);
      setCloseNotes("");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await router.push("/reconciliation");
    } catch (error: any) {
      setMessage(error.message || "تعذر إغلاق الوردية.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitForReview() {
    if (!session?.id) return setMessage("معرّف الجلسة غير صالح.");

    const missing = lines.flatMap((line) => {
      const readings = line.meter_readings?.length ? line.meter_readings : [
        line.meter_id && { reading_number: 1, opening_reading: line.opening_meter, closing_reading: line.closing_meter },
        line.meter2_id && { reading_number: 2, opening_reading: line.opening_meter2, closing_reading: line.closing_meter2 },
      ].filter(Boolean);
      return readings.filter((reading: any) => reading.opening_reading == null || reading.closing_reading == null).map((reading: any) => `${line.tank_code || line.fuel_name || "خزان غير معروف"} يحتاج قراءة العداد رقم ${reading.reading_number}`);
    });

    if (missing.length) {
      return setMessage(
        `أدخل قراءتي النهاية للعدادات التالية: ${missing.join("، ")}`
      );
    }

    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/reconciliation/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeaders()),
        },
        body: JSON.stringify({ session_id: session.id }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(messageFrom(data, "تعذر إرسال الجلسة للمراجعة."));
      }

      setMessage("تم إرسال الجلسة للمراجعة بنجاح.");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await router.push("/reconciliation");
    } catch (error: any) {
      setMessage(error.message || "تعذر إرسال الجلسة للمراجعة.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageLayout title="إغلاق الوردية">
        <main style={{ padding: "20px" }}>
          <SkeletonCard />
          <SkeletonCard />
        </main>
      </PageLayout>
    );
  }

  if (loadError) {
    return (
      <PageLayout title="إغلاق الوردية">
        <main style={{ padding: "20px" }}>
          <ErrorState onRetry={load} />
        </main>
      </PageLayout>
    );
  }

  if (!session) {
    return (
      <PageLayout title="إغلاق الوردية">
        <main style={{ padding: "20px" }}>
          <EmptyState title="لم يتم العثور على الجلسة" description="معرّف الجلسة غير صالح." />
        </main>
      </PageLayout>
    );
  }

  const canClose = role === "manager" || role === "supervisor";

  return (
    <PageLayout title={`إغلاق الوردية - ${shiftLabel(session)}`}>
      <main className="reconciliation-page" dir="rtl">
        <header className="page-heading">
          <div>
            <span className="eyebrow">تفاصيل الوردية</span>
            <h2>إغلاق الوردية</h2>
            <p>{session.business_date} · {shiftLabel(session)}</p>
          </div>
        </header>

        {message && (
          <div className={`notice ${message.includes("بنجاح") ? "notice-success" : "notice-warning"}`}>
            {message}
          </div>
        )}

        {session.status === "open" && (
          <section className="form-section">
            <h3>ملخص الجلسة</h3>
            <div className="recon-stats">
              <article>
                <small>إجمالي المبيعات</small>
                <b>{money(session.total_revenue || 0)}</b>
                <em>{formatQuantity(session.sold_quantity || 0)} لتر</em>
              </article>
              <article>
                <small>عدد المبيعات</small>
                <b>{session.sale_count || 0}</b>
                <em>عملية بيع</em>
              </article>
              <article>
                <small>إجمالي المحصل</small>
                <b>{money(session.total_collected || 0)}</b>
                <em>{session.sale_count || 0} عملية</em>
              </article>
              <article>
                <small>المتبقي</small>
                <b>{money(session.total_remaining || 0)}</b>
                <em>مبيعات آجلة</em>
              </article>
              <article>
                <small>الوارد / التوريدات</small>
                <b>{money(session.delivery_total || 0)}</b>
                <em>{formatQuantity(session.delivered_quantity || 0)} لتر</em>
              </article>
              <article>
                <small>تحصيلات العملاء</small>
                <b>{money(session.customer_payment_total || 0)}</b>
                <em>تحصيل نقدي</em>
              </article>
              <article>
                <small>مدفوعات الموردين</small>
                <b>{money(session.supplier_payment_total || 0)}</b>
                <em>دفع نقدي</em>
              </article>
              <article>
                <small>المصروفات</small>
                <b>{money(session.expense_total || 0)}</b>
                <em>المعتمد فقط</em>
              </article>
            </div>
          </section>
        )}

        <section className="form-section">
          <h3>التسوية والمخزون حسب الخزان</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الخزان</th>
                  <th>الافتتاح</th>
                  <th>التوريدات</th>
                  <th>المبيعات</th>
                  <th>النظري</th>
                  <th>الفعلي</th>
                  <th>الفرق</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.tank_code} · {line.tank_name}</td>
                    <td>{formatQuantity(line.opening_qty ?? 0)}</td>
                    <td>{formatQuantity(line.delivered_qty || 0)}</td>
                    <td>{formatQuantity(line.meter_sold_qty ?? line.sold_qty ?? 0)}</td>
                    <td>{formatQuantity(line.expected_closing_qty || 0)}</td>
                    <td>{line.actual_closing_qty == null ? "—" : formatQuantity(line.actual_closing_qty)}</td>
                    <td>{line.variance_qty == null ? "—" : formatQuantity(line.variance_qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {session.status === "open" && (
          <section className="form-section">
            <h3>العمليات المسجلة</h3>
            {session.operations?.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الوقت</th>
                      <th>النوع</th>
                      <th>التفاصيل</th>
                      <th>الكمية</th>
                      <th>القيمة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.operations.map((op: any) => (
                      <tr key={`${op.type}-${op.id}`}>
                        <td>{op.occurred_at ? new Date(op.occurred_at).toLocaleString("ar-EG") : "—"}</td>
                        <td>{op.type === "sale" ? "بيع" : op.type === "delivery" ? "توريد" : "أخرى"}</td>
                        <td>{op.detail || "—"}</td>
                        <td>{op.quantity ? formatQuantity(op.quantity) : "—"}</td>
                        <td>{money(op.value || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>لا توجد عمليات مسجلة.</p>
            )}
          </section>
        )}

        {session.status === "open" && (
          <section className="form-section" style={{ marginTop: "24px" }}>
            <h3>إجراءات الإغلاق</h3>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <button
                className="ui-button"
                onClick={() => setShowCloseConfirm(true)}
                disabled={!canClose || submitting}
                title={canClose ? "إغلاق الوردية نهائيًا" : "ليس لديك صلاحية إغلاق الوردية"}
              >
                {submitting ? "جارٍ الإغلاق…" : "إغلاق الوردية"}
              </button>
              <button
                className="ui-button secondary"
                onClick={submitForReview}
                disabled={submitting}
              >
                {submitting ? "جارٍ الإرسال…" : "إرسال للمراجعة"}
              </button>
              <button
                className="ui-button secondary"
                onClick={() => router.back()}
                disabled={submitting}
              >
                العودة
              </button>
            </div>
          </section>
        )}

        {showCloseConfirm && (
          <FormModal
            open={showCloseConfirm}
            title="تأكيد إغلاق الوردية"
            loading={submitting}
            onClose={() => !submitting && setShowCloseConfirm(false)}
            onSubmit={handleCloseShift}
            submitText="تأكيد الإغلاق"
          >
            <p style={{ marginBottom: "16px", color: "var(--text-muted)" }}>
              هل أنت متأكد من إغلاق الوردية؟ لا يمكن التراجع عن هذا الإجراء.
            </p>
            <div className="form-field">
              <label>ملاحظات الإغلاق (اختياري)</label>
              <textarea
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                placeholder="أضف ملاحظات إذا لزم الأمر…"
                style={{ minHeight: "80px", padding: "10px", borderRadius: "8px" }}
              />
            </div>
          </FormModal>
        )}
      </main>
    </PageLayout>
  );
}
