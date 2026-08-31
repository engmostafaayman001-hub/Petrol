import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "../../src/components/PageLayout";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../../src/components/DataState";
import { useRequireAuth, useRole } from "../../src/lib/auth";
import { useCurrentStationId } from "../../src/lib/station";
import { useParallelFetch } from "../../src/lib/optimizedFetch";
import { SkeletonLoader, SkeletonCard } from "../../src/components/SkeletonLoader";
import supabase from "../../src/lib/supabaseClient";

const messageFrom = (data: any, fallback: string) =>
  data?.error || data?.message || data?.hint || fallback;

type Shift = { id: string; seq: number; shift_period?: string };
type Meter = { id: string; code: string; name: string; tank_id: string; meter_slot?: number };
type Tank = {
  tank_id: string;
  tank_code: string;
  tank_name: string;
  fuel_name: string;
  system_quantity?: number;
  meter_readings_count?: number;
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
  customer_payment_total?: number;
  supplier_payment_total?: number;
  meter_sold?: number;
  meter_value?: number;
};
const shiftName = (shift?: { shift_period?: string; shift_seq?: number }) =>
  shift?.shift_period === "morning" || shift?.shift_seq === 1
    ? "صباحية"
    : "مسائية";
const dateInCairo = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(
    new Date(),
  );

function SessionMeterGrid({
  line,
  editable,
  sessionId,
  canManageShift,
  onSaved,
  detailReadings,
  setDetailReadings,
}: {
  line: any;
  editable: boolean;
  sessionId: string;
  canManageShift: boolean;
  onSaved: () => void;
  detailReadings: Record<string, string>;
  setDetailReadings: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const readings = line.meter_readings?.length ? line.meter_readings : [
    line.meter_id && { meter_id: line.meter_id, reading_number: 1, opening_reading: line.opening_meter, closing_reading: line.closing_meter, meter_code: line.meter_code, meter_name: line.meter_name },
    line.meter2_id && { meter_id: line.meter2_id, reading_number: 2, opening_reading: line.opening_meter2, closing_reading: line.closing_meter2, meter_code: line.meter2_code, meter_name: line.meter2_name },
  ].filter(Boolean);
  const [editing, setEditing] = useState<any>(null);
  const [newOpening, setNewOpening] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function saveOpening() {
    if (!editing || !reason.trim() || !Number.isFinite(Number(newOpening))) return setError("القراءة الجديدة وسبب التعديل مطلوبان.");
    setSaving(true); setError("");
    try {
      const { data: auth } = await supabase.auth.getSession();
      const response = await fetch("/api/reconciliation/opening", { method: "POST", headers: { "Content-Type": "application/json", ...(auth.session?.access_token ? { Authorization: `Bearer ${auth.session.access_token}` } : {}) }, body: JSON.stringify({ session_id: sessionId, meter_id: editing.meter_id, opening_reading: Number(newOpening), reason }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر تعديل قراءة البداية.");
      setEditing(null); setReason(""); setNewOpening(""); onSaved();
    } catch (reasonError: any) { setError(reasonError.message || "تعذر تعديل القراءة."); }
    finally { setSaving(false); }
  }
  return <><div className="session-meter-grid">{readings.map((reading: any, index: number) => <div key={reading.meter_id}><b>قراءة العداد {reading.reading_number || index + 1}</b><span>{reading.meter_code || reading.meter_name || 'غير مرتبط'}</span>{reading.opening_adjusted_by_manager && <em className="status-badge status-warning">تم تعديلها بواسطة المدير</em>}<small>فتح: {reading.opening_reading ?? '—'} · الإغلاق: {reading.closing_reading ?? '—'} · الفرق: {reading.meter_sold_qty ?? '—'} لتر · القيمة: {reading.meter_value == null ? '—' : `${Number(reading.meter_value).toLocaleString('ar-EG')} ج.م`}</small><small className={reading.inventory_deduction?.status === "pending" ? "text-amber-700" : "text-emerald-700"}>خصم المخزون: {reading.inventory_deduction?.status === "applied" ? `${Number(reading.inventory_deduction.quantity || reading.meter_sold_qty || 0).toLocaleString('ar-EG')} لتر · Applied` : "Pending Inventory Deduction"}</small>{canManageShift && editable && <button type="button" className="ui-button secondary mt-2" onClick={() => { setEditing(reading); setNewOpening(String(reading.opening_reading ?? "")); setError(""); }}>تعديل قراءة البداية</button>}{editable && <input type="number" min={reading.opening_reading ?? 0} step="0.001" placeholder="قراءة الإغلاق" value={detailReadings[`${line.id}:${reading.reading_number || index + 1}`] || ''} onChange={(event) => setDetailReadings((current) => ({ ...current, [`${line.id}:${reading.reading_number || index + 1}`]: event.target.value }))} />}</div>)}</div>{editing && <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="ui-card form-card modal-card form-grid" onMouseDown={(event) => event.stopPropagation()}><h3>تعديل قراءة العداد</h3><p>القراءة الحالية: {Number(editing.opening_reading).toLocaleString("ar-EG")}</p><div className="form-field"><label>القراءة الجديدة</label><input autoFocus type="number" min="0" step="0.001" value={newOpening} onChange={(event) => setNewOpening(event.target.value)} /></div><div className="form-field"><label>سبب التعديل</label><textarea required value={reason} onChange={(event) => setReason(event.target.value)} /></div><p className="text-amber-700">تعديل قراءة العداد سيؤثر على فرق العداد والمبيعات والتسوية والتقارير المرتبطة بهذه الجلسة.</p>{error && <p className="form-error">{error}</p>}<div className="form-actions"><button type="button" className="ui-button" disabled={saving} onClick={saveOpening}>{saving ? "جارٍ الحفظ…" : "تأكيد التعديل"}</button><button type="button" className="ui-button secondary" onClick={() => setEditing(null)}>إلغاء</button></div></section></div>}</>;
}

export default function ReconciliationIndex() {
  const { user } = useRequireAuth();
  const { role } = useRole();
  const canManageShift = role === "manager" || role === "supervisor";
  const stationId = useCurrentStationId(user?.id ?? null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [previousOpenings, setPreviousOpenings] = useState<Record<string, number>>({});
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
      setPreviousOpenings(openData.previous_openings || {});
      setReadings(Object.fromEntries(Object.entries(openData.previous_openings || {}).map(([meterId, value]) => [meterId, String(value)])));
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
    if (openSessions.length > 0) {
      setOpenForm(false);
      return setMessage("توجد وردية مفتوحة بالفعل. أغلق الوردية الحالية أولًا قبل فتح وردية جديدة.");
    }
    if (!stationId || !selectedShift)
      return setMessage("اختر نوع الوردية أولًا.");
    if (!groupedMeters.length || groupedMeters.some((group) => group.meters.length !== Number(group.tank.meter_readings_count || 1)))
      return setMessage("يجب توفر عدد العدادات المطلوب لكل خزان تشغيلي.");
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
      setDetailReadings(Object.fromEntries((data.lines || []).flatMap((line: any) => (line.meter_readings?.length ? line.meter_readings : [
        line.meter_id ? { meter_id: line.meter_id, reading_number: 1, opening_reading: line.opening_meter, closing_reading: line.closing_meter } : null,
        line.meter2_id ? { meter_id: line.meter2_id, reading_number: 2, opening_reading: line.opening_meter2, closing_reading: line.closing_meter2 } : null,
      ].filter(Boolean)).map((reading: any) => [`${line.id}:${reading.reading_number}`, reading.closing_reading == null ? "" : String(reading.closing_reading)]))));
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
        const readings = line.meter_readings?.length ? line.meter_readings : [
          line.meter_id ? { meter_id: line.meter_id, reading_number: 1, opening_reading: line.opening_meter } : null,
          line.meter2_id ? { meter_id: line.meter2_id, reading_number: 2, opening_reading: line.opening_meter2 } : null,
        ].filter(Boolean);
        const meters = readings.map((reading: any) => ({ id: reading.meter_id, value: detailReadings[`${line.id}:${reading.reading_number}`], opening: reading.opening_reading })) as Array<{ id: string; value: string; opening: number }>;
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
            <p>يحدد كل خزان عدد قراءات العداد المطلوبة، وتبقى جلساته القديمة محفوظة كما هي.</p>
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
            <b>{groupedMeters.reduce((total, group) => total + group.meters.length, 0)}</b>
            <em>إجمالي القراءات المطلوبة</em>
          </article>
        </section>
        <div className="page-heading">
          <div />{" "}
          <button
            className="btn btn-primary"
            disabled={loading || openSessions.length > 0}
            onClick={() => setOpenForm((visible) => !visible)}
          >
            {loading ? "جارٍ التحقق من الوردية…" : openForm ? "إغلاق النموذج" : "فتح وردية جديدة"}
          </button>
        </div>
        {openForm && (
          <div className="modal-backdrop recon-open-modal" role="dialog" aria-modal="true" aria-labelledby="open-session-title" onMouseDown={() => setOpenForm(false)}>
          <section className="panel recon-open-form recon-dynamic-form modal-card" onMouseDown={(event) => event.stopPropagation()}>
            <div>
              <div className="recon-modal-heading"><b id="open-session-title">نموذج فتح الوردية</b><button type="button" className="modal-close" aria-label="إغلاق نموذج فتح الوردية" onClick={() => setOpenForm(false)}>×</button></div>
              <small>
                كل بطاقة تخص خزانًا واحدًا وتعرض العدد المحدد له. الإجمالي الحالي: {groupedMeters.reduce((total, group) => total + group.meters.length, 0)} قراءة.
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
                      {group.tank.fuel_name} · {group.meters.length} قراءات مطلوبة · الرصيد الحالي{" "}
                      {Number(group.tank.system_quantity || 0).toLocaleString(
                        "ar-EG",
                      )}{" "}
                      لتر
                    </p>
                    <div className="meter-reading-grid">
                      {group.meters.map((meter, index) => (
                        <label key={meter.id}>
                          قراءة العداد {index + 1}
                          <small>{meter.code}</small>
                            <input
                            readOnly={!canManageShift && previousOpenings[meter.id] !== undefined}
                            aria-readonly={!canManageShift && previousOpenings[meter.id] !== undefined}
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
                            placeholder={canManageShift ? "قراءة البداية" : "قراءة تلقائية من إغلاق الجلسة السابقة"}
                          />
                          <small>{previousOpenings[meter.id] !== undefined ? "قراءة تلقائية من إغلاق الجلسة السابقة" : "أول جلسة: أدخل القراءة يدويًا"}{!canManageShift && previousOpenings[meter.id] !== undefined ? " 🔒" : ""}</small>
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
          </div>
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
                    أدخل قراءة النهاية لكل العدادات داخل صفحة الجلسة ثم اعتمد
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
              <div className="session-details-summary"><span>الحالة: {detailsSession.status === 'open' ? 'الجلسة مفتوحة' : 'الجلسة مغلقة'}</span><b>{detailsSession.business_date} · {shiftName(detailsSession)} · {detailLines.length} خزانات · {detailOperations.length} عملية</b></div>
              <div className="recon-stats session-modal-stats">
                <article><small>إجمالي المبيعات</small><b>{Number(detailsSession.total_revenue || 0).toLocaleString('ar-EG')} ج.م</b><em>{Number(detailsSession.sold_quantity || 0).toLocaleString('ar-EG')} لتر</em></article>
                <article><small>عدد المبيعات</small><b>{detailsSession.sale_count || 0}</b><em>عملية بيع</em></article>
                <article><small>إجمالي المحصل</small><b>{Number(detailsSession.total_collected || 0).toLocaleString('ar-EG')} ج.م</b><em>{detailsSession.sale_count || 0} عملية بيع</em></article>
                <article><small>المتبقي</small><b>{Number(detailsSession.total_remaining || 0).toLocaleString('ar-EG')} ج.م</b><em>مبيعات آجلة</em></article>
                <article><small>الوارد / التوريدات</small><b>{Number(detailsSession.delivery_total || 0).toLocaleString('ar-EG')} ج.م</b><em>{Number(detailsSession.delivered_quantity || 0).toLocaleString('ar-EG')} لتر · {detailsSession.delivery_count || 0} توريد</em></article>
                <article><small>تحصيلات العملاء</small><b>{Number(detailsSession.customer_payment_total || 0).toLocaleString('ar-EG')} ج.م</b><em>تحصيل نقدي</em></article>
                <article><small>مدفوعات الموردين</small><b>{Number(detailsSession.supplier_payment_total || 0).toLocaleString('ar-EG')} ج.م</b><em>دفع نقدي</em></article>
                <article><small>المصروفات</small><b>{Number(detailsSession.expense_total || 0).toLocaleString('ar-EG')} ج.م</b><em>المعتمد فقط</em></article>
                <article><small>صافي الحركة النقدية</small><b>{(Number(detailsSession.total_collected || 0) - Number(detailsSession.supplier_payment_total || 0)).toLocaleString('ar-EG')} ج.م</b><em>النقد الداخل ناقص المدفوعات</em></article>
                <article><small>فرق العدادات</small><b>{Number(detailLines.reduce((total, line) => total + (line.meter_readings || []).reduce((sum: number, reading: any) => sum + Number(reading.meter_sold_qty || 0), 0), 0)).toLocaleString('ar-EG')} لتر</b><em>مجموع الفروق</em></article>
                <article><small>قيمة فرق العدادات</small><b>{Number(detailLines.reduce((total, line) => total + (line.meter_readings || []).reduce((sum: number, reading: any) => sum + Number(reading.meter_value || 0), 0), 0)).toLocaleString('ar-EG')} ج.م</b><em>بسعر الجلسة المحفوظ</em></article>
              </div>
              <section className="session-detail-section"><h4>التسوية والمخزون حسب الخزان</h4><div className="table-scroll"><table className="data-table"><thead><tr><th>الخزان</th><th>الرصيد الافتتاحي</th><th>التوريدات</th><th>المبيعات</th><th>الرصيد النظري</th><th>الرصيد الفعلي</th><th>فرق التسوية</th></tr></thead><tbody>{detailLines.map((line) => <tr key={line.id}><td>{line.tank_code} · {line.tank_name || line.fuel_name}</td><td>{Number(line.opening_qty ?? line.opening_tank_qty ?? 0).toLocaleString('ar-EG')} لتر</td><td>{Number(line.delivered_qty || 0).toLocaleString('ar-EG')} لتر</td><td>{Number(line.meter_sold_qty ?? line.sold_qty ?? 0).toLocaleString('ar-EG')} لتر</td><td>{Number(line.expected_closing_qty || 0).toLocaleString('ar-EG')} لتر</td><td>{line.actual_closing_qty == null ? '—' : `${Number(line.actual_closing_qty).toLocaleString('ar-EG')} لتر`}</td><td>{line.variance_qty == null ? '—' : `${Number(line.variance_qty).toLocaleString('ar-EG')} لتر`}</td></tr>)}</tbody></table></div></section>
              <div className="session-detail-lines">{detailLines.map((line) => <article className="session-detail-line" key={line.id}><header><b>{line.tank_code} · {line.tank_name || line.fuel_name}</b><span>{line.fuel_name || 'وقود'}</span></header><SessionMeterGrid line={line} editable={detailsSession.status === 'open'} sessionId={detailsSession.id} canManageShift={canManageShift} onSaved={() => showSessionDetails(detailsSession)} detailReadings={detailReadings} setDetailReadings={setDetailReadings} /><footer>الافتتاح: {line.opening_tank_qty ?? '—'} لتر · التوريد: {line.delivered_qty ?? '—'} لتر · البيع: {line.sold_qty ?? '—'} لتر · المتوقع: {line.expected_closing_qty ?? '—'} لتر · الفعلي: {line.actual_closing_qty ?? '—'} لتر · الفرق: {line.variance_qty ?? '—'} لتر</footer></article>)}</div>
              <section className="session-operations-modal"><h4>تفاصيل عمليات الجلسة</h4>{detailOperations.length ? <div className="table-wrap"><table><thead><tr><th>الوقت</th><th>النوع</th><th>التفاصيل</th><th>الكمية</th><th>القيمة</th><th>الحساب</th></tr></thead><tbody>{detailOperations.map((operation: any) => <tr key={`${operation.type}-${operation.id}`}><td>{operation.occurred_at ? new Date(operation.occurred_at).toLocaleString('ar-EG') : '—'}</td><td>{operation.type === 'sale' ? 'بيع' : operation.type === 'delivery' ? 'توريد' : operation.type === 'customer_payment' ? 'تحصيل عميل' : operation.type === 'supplier_payment' ? 'دفع مورد' : 'خدمة'}</td><td>{operation.detail || '—'}</td><td>{operation.quantity ? `${Number(operation.quantity).toLocaleString('ar-EG')} لتر` : '—'}</td><td>{Number(operation.value || 0).toLocaleString('ar-EG')} ج.م</td><td>{operation.account || '—'}</td></tr>)}</tbody></table></div> : <p>لا توجد عمليات مسجلة لهذه الجلسة.</p>}</section>
              {detailsSession.status === 'open' && <><button className="ui-button mt-4" disabled={savingDetailReadings} onClick={saveDetailReadings}>{savingDetailReadings ? 'جارٍ حفظ القراءات...' : 'حفظ قراءات العدادات'}</button><button className="ui-button secondary mt-4 mr-2" onClick={() => { window.location.href = `/reconciliation/session?sessionId=${detailsSession.id}`; }}>فتح شاشة الإغلاق الكاملة</button></>}
            </>}
          </section>
        </div>
      )}
    </PageLayout>
  );
}
