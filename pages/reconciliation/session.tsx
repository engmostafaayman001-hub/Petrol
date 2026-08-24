import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import PageLayout from "../../src/components/PageLayout";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../../src/components/DataState";
import { useRequireAuth } from "../../src/lib/auth";
import supabase from "../../src/lib/supabaseClient";
import { shiftLabel } from "../../src/lib/displayLabels";

const messageFrom = (data: any, fallback: string) =>
  data?.error || data?.message || data?.hint || fallback;
const money = (value: number) =>
  `${Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;
export default function SessionPage() {
  const router = useRouter();
  useRequireAuth();
  const sessionId =
    typeof router.query.sessionId === "string" ? router.query.sessionId : "";
  const [session, setSession] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
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
        { headers: await authHeaders() },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(messageFrom(data, "تعذر تحميل تفاصيل الجلسة."));
      setSession({ ...data.session, operations: data.operations || [] });
      setLines(data.lines || []);
    } catch (error: any) {
      setLoadError(error.message || "تعذر الاتصال بالخادم.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, sessionId]);
  useEffect(() => {
    load();
  }, [load]);
  async function submit() {
    if (!session?.id) return setMessage("معرّف الجلسة غير صالح.");
    const missing = lines
      .filter(
        (line) =>
          line.opening_meter == null ||
          line.closing_meter == null ||
          (line.meter2_id &&
            (line.opening_meter2 == null || line.closing_meter2 == null)),
      )
      .map((line) => line.tank_code || line.fuel_name || "خزان غير معروف");
    if (missing.length)
      return setMessage(
        `أدخل قراءتي النهاية للعدادات التالية: ${missing.join("، ")}`,
      );
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
        await load();
        setMessage(
          [messageFrom(data, "تعذر إغلاق الوردية."), data.details, data.hint]
            .filter(Boolean)
            .join(" "),
        );
        return;
      }
      await router.replace("/reconciliation");
    } catch {
      setMessage("حدث خطأ في الاتصال بالخادم أثناء إغلاق الوردية.");
    } finally {
      setSubmitting(false);
    }
  }
  if (loading)
    return (
      <PageLayout title="التسوية">
        <LoadingState />
      </PageLayout>
    );
  if (loadError)
    return (
      <PageLayout title="التسوية">
        <ErrorState onRetry={load} />
      </PageLayout>
    );
  if (!session)
    return (
      <PageLayout title="التسوية">
        <EmptyState title="الجلسة غير موجودة" description="تحقق من الرابط." />
      </PageLayout>
    );
  const isOpen = session.status === "open";
  return (
    <PageLayout title="إغلاق الوردية">
      <main className="reconciliation-page" dir="rtl">
        <div className="page-heading">
          <div>
            <span className="eyebrow">إغلاق الوردية</span>
            <h2>
              {session.business_date} ·{" "}
              {shiftLabel(session.shift_name, session.shift_code, session.shift_seq)}
            </h2>
            <p>أدخل قراءة النهاية لكل عداد. لكل خزان عدادان مستقلان.</p>
          </div>
          <button className="ui-button secondary" onClick={load}>
            تحديث
          </button>
        </div>
        {!isOpen && (
          <div className="notice notice-warning">
            هذه الوردية مغلقة ومتاحة للمراجعة فقط.
          </div>
        )}
        <section className="ui-card p-5 mb-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <small>المستخدم</small>
              <b className="block mt-1">{session.opened_by_name || "—"}</b>
            </div>
            <div>
              <small>وقت البداية</small>
              <b className="block mt-1">
                {session.opened_at
                  ? new Date(session.opened_at).toLocaleString("ar-EG")
                  : "—"}
              </b>
            </div>
            <div>
              <small>وقت النهاية</small>
              <b className="block mt-1">
                {session.submitted_at
                  ? new Date(session.submitted_at).toLocaleString("ar-EG")
                  : "لم تغلق بعد"}
              </b>
            </div>
            <div>
              <small>إجمالي المبيعات</small>
              <strong className="block mt-1 text-xl text-[var(--text-heading)]">
                {money(session.total_revenue ?? session.total_collected)}
              </strong>
            </div>
          </div>
        </section>
        <section className="recon-stats mb-5">
          <article><small>المبيعات المحصلة</small><b>{money(session.total_collected)}</b></article>
          <article><small>المتبقي</small><b>{money(session.total_remaining)}</b></article>
          <article><small>عدد المبيعات</small><b>{session.sale_count || 0}</b><em>{Number(session.sold_quantity || 0).toLocaleString("ar-EG")} لتر</em></article>
          <article><small>التوريدات</small><b>{Number(session.delivery_total || 0).toLocaleString("ar-EG")} ج.م</b><em>{session.delivery_count || 0} عملية · {Number(session.delivered_quantity || 0).toLocaleString("ar-EG")} لتر</em></article>
        </section>
        <section className="ui-card p-5 mb-5">
          <header className="section-card-header"><div><h3>عمليات الجلسة</h3><p>كل عملية مسجلة أثناء الجلسة، مرتبة من الأحدث.</p></div><span className="status-badge">{(session.operations || []).length} عملية</span></header>
          {(session.operations || []).length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>الوقت</th><th>النوع</th><th>التفاصيل</th><th>الكمية</th><th>القيمة</th><th>الحساب</th><th>الحالة</th></tr></thead><tbody>{session.operations.map((operation: any) => <tr key={`${operation.type}-${operation.id}`}><td>{operation.occurred_at ? new Date(operation.occurred_at).toLocaleString("ar-EG") : "—"}</td><td>{operation.type === "sale" ? "بيع" : operation.type === "delivery" ? "توريد" : "خدمة"}</td><td>{operation.detail || "—"}</td><td>{operation.quantity ? `${Number(operation.quantity).toLocaleString("ar-EG")} لتر` : "—"}</td><td>{money(operation.value)}</td><td>{operation.account || "—"}</td><td><span className="status-badge status-success">نشطة</span></td></tr>)}</tbody></table></div> : <EmptyState title="لا توجد عمليات بعد" description="ستظهر المبيعات والتوريدات والخدمات هنا." />}
        </section>
        <div className="space-y-3">
          {lines.map((line) => (
            <MeterLine
              key={line.id}
              line={line}
              sessionId={session.id}
              onSaved={load}
              disabled={!isOpen}
            />
          ))}
        </div>
        {isOpen && (
          <div className="mt-6 text-right">
            <button
              className="ui-button"
              disabled={submitting}
              onClick={submit}
            >
              {submitting ? "جارٍ الإغلاق…" : "تأكيد إغلاق الوردية"}
            </button>
            {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
          </div>
        )}
      </main>
    </PageLayout>
  );
}
function MeterLine({
  line,
  sessionId,
  onSaved,
  disabled,
}: {
  line: any;
  sessionId: string;
  onSaved: () => void;
  disabled: boolean;
}) {
  const [first, setFirst] = useState(
    line.closing_meter == null ? "" : String(line.closing_meter),
  );
  const [second, setSecond] = useState(
    line.closing_meter2 == null ? "" : String(line.closing_meter2),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    const values = [
      {
        id: line.meter_id,
        opening: Number(line.opening_meter),
        value: Number(first),
      },
      ...(line.meter2_id
        ? [
            {
              id: line.meter2_id,
              opening: Number(line.opening_meter2),
              value: Number(second),
            },
          ]
        : []),
    ];
    if (
      values.some(
        (item) =>
          !item.id ||
          !Number.isFinite(item.opening) ||
          !Number.isFinite(item.value) ||
          item.value < item.opening,
      )
    ) {
      setError("تحقق من قراءتي النهاية، ويجب ألا تقل أي قراءة عن البداية.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { data: auth } = await supabase.auth.getSession();
      for (const item of values) {
        const response = await fetch("/api/reconciliation/record", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(auth.session?.access_token
              ? { Authorization: `Bearer ${auth.session.access_token}` }
              : {}),
          },
          body: JSON.stringify({
            session_id: sessionId,
            meter_id: item.id,
            meter_reading: item.value,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(messageFrom(data, "تعذر حفظ قراءة العداد."));
      }
      await onSaved();
    } catch (reason: any) {
      setError(reason.message || "تعذر حفظ القراءات.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="ui-card p-4 text-right">
      <header className="section-card-header">
        <div>
          <h3>
            {line.tank_code} · {line.fuel_name}
          </h3>
          <p>عدادان مستقلان · الكمية المحسوبة من الفرق تلقائيًا</p>
        </div>
        <span className="status-badge status-info">قراءة النهاية</span>
      </header>
      <div className="meter-reading-grid">
        <label>
          العداد الأول
          <small>
            البداية: {Number(line.opening_meter || 0).toLocaleString("ar-EG")}
          </small>
          <input
            disabled={disabled || saving}
            type="number"
            min="0"
            step="0.001"
            value={first}
            onChange={(event) => setFirst(event.target.value)}
            placeholder="قراءة النهاية"
          />
        </label>
        {line.meter2_id && (
          <label>
            العداد الثاني
            <small>
              البداية:{" "}
              {Number(line.opening_meter2 || 0).toLocaleString("ar-EG")}
            </small>
            <input
              disabled={disabled || saving}
              type="number"
              min="0"
              step="0.001"
              value={second}
              onChange={(event) => setSecond(event.target.value)}
              placeholder="قراءة النهاية"
            />
          </label>
        )}
      </div>
      {!disabled && (
        <button className="ui-button mt-3" disabled={saving} onClick={save}>
          {saving ? "جارٍ الحفظ…" : "حفظ قراءات العدادين"}
        </button>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
