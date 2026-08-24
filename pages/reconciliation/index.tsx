import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "../../src/components/PageLayout";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../../src/components/DataState";
import { useRequireAuth } from "../../src/lib/auth";
import { useCurrentStationId } from "../../src/lib/station";
import supabase from "../../src/lib/supabaseClient";

const messageFrom = (data: any, fallback: string) =>
  data?.error || data?.message || data?.hint || fallback;

type Shift = { id: string; seq: number; shift_period?: string };
type Meter = { id: string; code: string; name: string; tank_id: string };
type Tank = {
  tank_id: string;
  tank_code: string;
  tank_name: string;
  fuel_name: string;
  system_quantity?: number;
};
type Session = {
  id: string;
  business_date: string;
  shift_seq?: number;
  status: string;
  opened_at?: string;
  submitted_at?: string;
  variance_value?: number;
  total_revenue?: number;
  total_collected?: number;
  total_remaining?: number;
  sold_quantity?: number;
  sale_count?: number;
  delivered_quantity?: number;
  delivery_count?: number;
  delivery_total?: number;
  expense_total?: number;
  net_collected?: number;
};
const shiftName = (shift?: { shift_period?: string; shift_seq?: number }) =>
  shift?.shift_period === "morning" || shift?.shift_seq === 1
    ? "صباحية"
    : "مسائية";
const dateInCairo = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(
    new Date(),
  );
export default function ReconciliationIndex() {
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [selectedShift, setSelectedShift] = useState("");
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [openForm, setOpenForm] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [detailsSession, setDetailsSession] = useState<Session | null>(null);
  const [detailLines, setDetailLines] = useState<any[]>([]);
  const [detailOperations, setDetailOperations] = useState<any[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [detailReadings, setDetailReadings] = useState<Record<string, string>>({});
  const [savingDetailReadings, setSavingDetailReadings] = useState(false);
  const load = useCallback(async () => {
    if (!stationId) return;
    setLoading(true);
    setError("");
    try {
      const { data: auth } = await supabase.auth.getSession();
      const headers: Record<string, string> = auth.session?.access_token
        ? { Authorization: `Bearer ${auth.session.access_token}` }
        : {};
      const [openResponse, listResponse] = await Promise.all([
        fetch(
          `/api/reconciliation/open-data?stationId=${encodeURIComponent(stationId)}`,
          { headers },
        ),
        fetch(
          `/api/reconciliation/list?stationId=${encodeURIComponent(stationId)}`,
          { headers },
        ),
      ]);
      const openData = await openResponse.json();
      const listData = await listResponse.json();
      if (!openResponse.ok)
        throw new Error(openData.error || "تعذر تحميل بيانات فتح الوردية.");
      if (!listResponse.ok)
        throw new Error(listData.error || "تعذر تحميل الجلسات.");
      setShifts(openData.shifts || []);
      setSelectedShift((current) => current || openData.shifts?.[0]?.id || "");
      setMeters(openData.meters || []);
      setTanks(openData.tanks || []);
      setSessions(listData.sessions || []);
    } catch (reason: any) {
      setError(reason.message || "تعذر تحميل بيانات الوردية.");
    } finally {
      setLoading(false);
    }
  }, [stationId]);
  useEffect(() => {
    load();
  }, [load]);
  const openSessions = useMemo(
    () => sessions.filter((session) => session.status === "open"),
    [sessions],
  );
  const closedSessions = useMemo(
    () => sessions.filter((session) => session.status !== "open"),
    [sessions],
  );
  const groupedMeters = useMemo(
    () =>
      tanks.map((tank) => ({
        tank,
        meters: meters
          .filter((meter) => meter.tank_id === tank.tank_id)
          .sort((a, b) => a.code.localeCompare(b.code)),
      })),
    [meters, tanks],
  );
  async function openSession(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!stationId || !selectedShift)
      return setMessage("اختر نوع الوردية أولًا.");
    if (
      !groupedMeters.length ||
      groupedMeters.some(
        (group) =>
          group.meters.length !== 2 ||
          new Set(group.meters.map((meter) => meter.code)).size !== 2,
      )
    )
      return setMessage("يجب توفر عدادين نشطين مختلفين لكل خزان تشغيلي.");
    const openingMeters = meters.map((meter) => ({
      meter_id: meter.id,
      reading: Number(readings[meter.id]),
    }));
    if (
      openingMeters.length !== meters.length ||
      openingMeters.some(
        (item) => !Number.isFinite(item.reading) || item.reading < 0,
      )
    )
      return setMessage("أدخل قراءة بداية صحيحة لكل العدادات.");
    const openingTanks = tanks.map((tank) => ({
      tank_id: tank.tank_id,
      reading: Number(tank.system_quantity || 0),
    }));
    setOpening(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (auth.session?.access_token)
        headers.Authorization = `Bearer ${auth.session.access_token}`;
      const response = await fetch("/api/reconciliation/open", {
        method: "POST",
        headers,
        body: JSON.stringify({
          station_id: stationId,
          shift_id: selectedShift,
          opening_meters: openingMeters,
          opening_tanks: openingTanks,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          [data.error, data.details, data.hint].filter(Boolean).join(" ") ||
            "تعذر فتح الوردية.",
        );
      setOpenForm(false);
      setReadings({});
      setMessage("تم فتح الوردية وحفظ قراءتي كل عداد.");
      await load();
    } catch (reason: any) {
      setMessage(reason.message || "تعذر فتح الوردية.");
    } finally {
      setOpening(false);
    }
  }
  async function showSessionDetails(session: Session) {
    setDetailsSession(session);
    setDetailLines([]);
    setDetailOperations([]);
    setDetailsError("");
    setDetailsLoading(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const headers: Record<string, string> = auth.session?.access_token
        ? { Authorization: `Bearer ${auth.session.access_token}` }
        : {};
      const response = await fetch(
        `/api/reconciliation/detail?sessionId=${encodeURIComponent(session.id)}`,
        { headers },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر تحميل تفاصيل الجلسة.");
      setDetailsSession(data.session || session);
      setDetailLines(data.lines || []);
      setDetailOperations(data.operations || []);
      setDetailReadings(Object.fromEntries((data.lines || []).flatMap((line: any) => [
        line.meter_id ? [`${line.id}:1`, line.closing_meter == null ? "" : String(line.closing_meter)] : [],
        line.meter2_id ? [`${line.id}:2`, line.closing_meter2 == null ? "" : String(line.closing_meter2)] : [],
      ])));
    } catch (reason: any) {
      setDetailsError(reason.message || "تعذر تحميل تفاصيل الجلسة.");
    } finally {
      setDetailsLoading(false);
    }
  }
  async function saveDetailReadings() {
    if (!detailsSession || detailsSession.status !== "open") return;
    setSavingDetailReadings(true);
    setDetailsError("");
    try {
      const { data: auth } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json", ...(auth.session?.access_token ? { Authorization: `Bearer ${auth.session.access_token}` } : {}) };
      for (const line of detailLines) {
        const meters = [
          line.meter_id ? { id: line.meter_id, value: detailReadings[`${line.id}:1`], opening: line.opening_meter } : null,
          line.meter2_id ? { id: line.meter2_id, value: detailReadings[`${line.id}:2`], opening: line.opening_meter2 } : null,
        ].filter(Boolean) as Array<{ id: string; value: string; opening: number }>;
        for (const meter of meters) {
          const value = Number(meter.value);
          if (!Number.isFinite(value) || value < Number(meter.opening)) throw new Error("تحقق من قراءات الإغلاق، ويجب ألا تقل عن قراءات البداية.");
          const response = await fetch("/api/reconciliation/record", { method: "POST", headers, body: JSON.stringify({ session_id: detailsSession.id, meter_id: meter.id, meter_reading: value }) });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(messageFrom(data, "تعذر حفظ قراءة العداد."));
        }
      }
      await showSessionDetails(detailsSession);
    } catch (error: any) {
      setDetailsError(error.message || "تعذر حفظ قراءات العدادات.");
    } finally {
      setSavingDetailReadings(false);
    }
  }
  return (
    <PageLayout title="التسويات">
      <main className="reconciliation-page" dir="rtl">
        <header className="page-heading">
          <div>
            <span className="eyebrow">إدارة الورديات</span>
            <h2>فتح وإغلاق الوردية</h2>
            <p>
              لكل خزان عدادان مستقلان، أي قراءتان عند الفتح وقراءتان عند
              الإغلاق.
            </p>
          </div>
        </header>
        <section className="recon-stats">
          <article>
            <small>الجلسات المفتوحة</small>
            <b>{openSessions.length}</b>
          </article>
          <article>
            <small>الجلسات المغلقة</small>
            <b>{closedSessions.length}</b>
          </article>
          <article>
            <small>إجمالي خانات القراءة</small>
            <b>{tanks.length * 2}</b>
            <em>{tanks.length} خزان × 2</em>
          </article>
        </section>
        <div className="page-heading">
          <div />{" "}
          <button
            className="btn btn-primary"
            disabled={openSessions.length > 0}
            onClick={() => setOpenForm((visible) => !visible)}
          >
            {openForm ? "إغلاق النموذج" : "فتح وردية جديدة"}
          </button>
        </div>
        {openForm && (
          <section className="panel recon-open-form recon-dynamic-form">
            <div>
              <b>نموذج فتح الوردية</b>
              <small>
                كل بطاقة تخص خزانًا واحدًا وتحتوي على العداد الأول والثاني.
                الإجمالي الحالي: {tanks.length * 2} قراءة عداد.
              </small>
            </div>
            <form onSubmit={openSession}>
              <label>
                نوع الوردية
                <select
                  required
                  value={selectedShift}
                  onChange={(event) => setSelectedShift(event.target.value)}
                >
                  <option value="">اختر الوردية</option>
                  {shifts.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {shiftName(shift)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="recon-tank-opening-grid">
                {groupedMeters.map((group) => (
                  <fieldset
                    className="recon-tank-card"
                    key={group.tank.tank_id}
                  >
                    <legend>
                      {group.tank.tank_code} · {group.tank.tank_name}
                    </legend>
                    <p>
                      {group.tank.fuel_name} · الرصيد الحالي{" "}
                      {Number(group.tank.system_quantity || 0).toLocaleString(
                        "ar-EG",
                      )}{" "}
                      لتر
                    </p>
                    <div className="meter-reading-grid">
                      {group.meters.map((meter, index) => (
                        <label key={meter.id}>
                          العداد {index + 1}
                          <small>{meter.code}</small>
                          <input
                            required
                            min="0"
                            step="0.001"
                            type="number"
                            value={readings[meter.id] || ""}
                            onChange={(event) =>
                              setReadings((current) => ({
                                ...current,
                                [meter.id]: event.target.value,
                              }))
                            }
                            placeholder="قراءة البداية"
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              <button
                className="btn btn-primary"
                disabled={opening || !selectedShift || !groupedMeters.length}
              >
                {opening ? "جارٍ الحفظ…" : "فتح الوردية وحفظ القراءات"}
              </button>
            </form>
          </section>
        )}
        {message && <div className="notice notice-warning">{message}</div>}
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : (
          <>
            <section className="recon-section">
              <div className="recon-heading">
                <div>
                  <h3>الورديات المفتوحة</h3>
                  <p>
                    أدخل قراءة النهاية للعدادين داخل صفحة الجلسة ثم اعتمد
                    الإغلاق.
                  </p>
                </div>
                <span>{openSessions.length}</span>
              </div>
              {openSessions.length ? (
                <div className="recon-open-grid">
                  {openSessions.map((session) => (
                    <article className="recon-session-card" key={session.id}>
                      <span className="recon-live">مفتوحة الآن</span>
                      <h4>{shiftName(session)}</h4>
                      <p>{session.business_date}</p>
                      <button
                        className="btn btn-primary"
                        onClick={() => showSessionDetails(session)}
                      >
                        متابعة وإغلاق الوردية
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="لا توجد ورديات مفتوحة"
                  description="افتح وردية جديدة وسجل قراءتي كل خزان."
                />
              )}
            </section>
            <section className="recon-section">
              <div className="recon-heading">
                <div>
                  <h3>سجل الورديات المغلقة</h3>
                  <p>الورديات السابقة متاحة للمراجعة.</p>
                </div>
                <span>{closedSessions.length}</span>
              </div>
              {closedSessions.length ? (
                <div className="panel recon-archive">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          <th>الوردية</th>
                          <th>الحالة</th>
                          <th>التفاصيل</th>
                        </tr>
                      </thead>
                      <tbody>
                        {closedSessions.map((session) => (
                          <tr key={session.id}>
                            <td>{session.business_date}</td>
                            <td>{shiftName(session)}</td>
                            <td>مغلقة</td>
                            <td>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => showSessionDetails(session)}
                              >
                                عرض التفاصيل
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="لا يوجد سجل مغلق"
                  description="ستظهر الجلسات هنا بعد الإغلاق."
                />
              )}
            </section>
          </>
        )}
      </main>
      {detailsSession && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={() => setDetailsSession(null)}>
          <section className="ui-card form-card modal-card session-details-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header className="section-card-header">
              <div><h3>تفاصيل الجلسة</h3><p>{detailsSession.business_date} · {shiftName(detailsSession)}</p></div>
              <button type="button" className="modal-close" onClick={() => setDetailsSession(null)}>×</button>
            </header>
            {detailsLoading ? <LoadingState /> : detailsError ? <p className="form-error">{detailsError}</p> : <>
              <div className="session-details-summary"><span>الحالة: {detailsSession.status === 'open' ? 'مفتوحة' : 'مغلقة'}</span><b>{detailLines.length} خزانات · {detailOperations.length} عملية</b></div>
              <div className="recon-stats session-modal-stats">
                <article><small>إجمالي المبيعات</small><b>{Number(detailsSession.total_revenue || 0).toLocaleString('ar-EG')} ج.م</b><em>{Number(detailsSession.sold_quantity || 0).toLocaleString('ar-EG')} لتر</em></article>
                <article><small>إجمالي المحصل</small><b>{Number(detailsSession.total_collected || 0).toLocaleString('ar-EG')} ج.م</b><em>{detailsSession.sale_count || 0} عملية بيع</em></article>
                <article><small>المتبقي</small><b>{Number(detailsSession.total_remaining || 0).toLocaleString('ar-EG')} ج.م</b><em>مبيعات آجلة</em></article>
                <article><small>الوارد / التوريدات</small><b>{Number(detailsSession.delivery_total || 0).toLocaleString('ar-EG')} ج.م</b><em>{Number(detailsSession.delivered_quantity || 0).toLocaleString('ar-EG')} لتر · {detailsSession.delivery_count || 0} توريد</em></article>
                <article><small>المصروفات</small><b>{Number(detailsSession.expense_total || 0).toLocaleString('ar-EG')} ج.م</b><em>المعتمد فقط</em></article>
                <article><small>صافي المحصل</small><b>{Number(detailsSession.net_collected || 0).toLocaleString('ar-EG')} ج.م</b><em>بعد المصروفات</em></article>
              </div>
              <div className="session-detail-lines">{detailLines.map((line) => <article className="session-detail-line" key={line.id}><header><b>{line.tank_code} · {line.tank_name || line.fuel_name}</b><span>{line.fuel_name || 'وقود'}</span></header><div className="session-meter-grid"><div><b>العداد الأول</b><span>{line.meter_code || line.meter_name || 'غير مرتبط'}</span><small>فتح: {line.opening_meter ?? '—'} · الإغلاق: {line.closing_meter ?? '—'}</small>{detailsSession.status === 'open' && line.meter_id && <input type="number" min={line.opening_meter ?? 0} step="0.001" placeholder="قراءة الإغلاق" value={detailReadings[`${line.id}:1`] || ''} onChange={(event) => setDetailReadings((current) => ({ ...current, [`${line.id}:1`]: event.target.value }))} />}</div><div><b>العداد الثاني</b><span>{line.meter2_code || line.meter2_name || 'غير مرتبط'}</span><small>فتح: {line.opening_meter2 ?? '—'} · الإغلاق: {line.closing_meter2 ?? '—'}</small>{detailsSession.status === 'open' && line.meter2_id && <input type="number" min={line.opening_meter2 ?? 0} step="0.001" placeholder="قراءة الإغلاق" value={detailReadings[`${line.id}:2`] || ''} onChange={(event) => setDetailReadings((current) => ({ ...current, [`${line.id}:2`]: event.target.value }))} />}</div></div><footer>الافتتاح: {line.opening_tank_qty ?? '—'} لتر · التوريد: {line.delivered_qty ?? '—'} لتر · البيع: {line.sold_qty ?? '—'} لتر · المتوقع: {line.expected_closing_qty ?? '—'} لتر · الفعلي: {line.actual_closing_qty ?? '—'} لتر · الفرق: {line.variance_qty ?? '—'} لتر</footer></article>)}</div>
              <section className="session-operations-modal"><h4>تفاصيل عمليات الجلسة</h4>{detailOperations.length ? <div className="table-wrap"><table><thead><tr><th>الوقت</th><th>النوع</th><th>التفاصيل</th><th>الكمية</th><th>القيمة</th><th>الحساب</th></tr></thead><tbody>{detailOperations.map((operation: any) => <tr key={`${operation.type}-${operation.id}`}><td>{operation.occurred_at ? new Date(operation.occurred_at).toLocaleString('ar-EG') : '—'}</td><td>{operation.type === 'sale' ? 'بيع' : operation.type === 'delivery' ? 'توريد' : 'خدمة'}</td><td>{operation.detail || '—'}</td><td>{operation.quantity ? `${Number(operation.quantity).toLocaleString('ar-EG')} لتر` : '—'}</td><td>{Number(operation.value || 0).toLocaleString('ar-EG')} ج.م</td><td>{operation.account || '—'}</td></tr>)}</tbody></table></div> : <p>لا توجد عمليات مسجلة لهذه الجلسة.</p>}</section>
              {detailsSession.status === 'open' && <><button className="ui-button mt-4" disabled={savingDetailReadings} onClick={saveDetailReadings}>{savingDetailReadings ? 'جارٍ حفظ القراءات...' : 'حفظ قراءات العدادات'}</button><button className="ui-button secondary mt-4 mr-2" onClick={() => { window.location.href = `/reconciliation/session?sessionId=${detailsSession.id}`; }}>فتح شاشة الإغلاق الكاملة</button></>}
            </>}
          </section>
        </div>
      )}
    </PageLayout>
  );
}
