import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import PageLayout from '../../src/components/PageLayout';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/DataState';
import { useRequireAuth } from '../../src/lib/auth';
import { useCurrentStationId } from '../../src/lib/station';
import supabase from '../../src/lib/supabaseClient';

type ShiftOption = { id: string; code: string; name: string; seq: number; shift_period?: 'morning' | 'evening' };
type MeterOption = { id: string; code: string; name: string; tank_id: string };
type Session = { id: string; business_date: string; shift_id?: string; shift_code?: string; shift_name?: string; shift_seq?: number; shift_period?: 'morning' | 'evening'; status: string; opened_at?: string; submitted_at?: string; variance_value?: number };
const statusText = (value: string) => value === 'open' ? 'مفتوحة' : value === 'submitted' ? 'مغلقة' : value;
const shiftLabel = (shift: { shift_period?: 'morning' | 'evening'; shift_seq?: number; shift_code?: string }) => shift.shift_period === 'morning' || shift.shift_seq === 1 || shift.shift_code === 'A' ? 'صباحية' : 'مسائية';
const cairoBusinessDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((value, part) => ({ ...value, [part.type]: part.value }), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export default function ReconciliationIndex() {
  const router = useRouter();
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [shift, setShift] = useState('');
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [meters, setMeters] = useState<MeterOption[]>([]);
  const [meterReadings, setMeterReadings] = useState<Record<string, string>>({});
  const [openFormVisible, setOpenFormVisible] = useState(false);
  const [operatorName, setOperatorName] = useState('');
  const [openingDate, setOpeningDate] = useState('');
  const [openingTime, setOpeningTime] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    if (!stationId) { setSessions([]); setShifts([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const { data: authData } = await supabase.auth.getSession();
      const headers: HeadersInit = authData.session?.access_token ? { Authorization: `Bearer ${authData.session.access_token}` } : {};
      const [openDataResult, sessionResult] = await Promise.all([
        fetch(`/api/reconciliation/open-data?stationId=${encodeURIComponent(stationId)}`, { headers }).then(async (response) => ({ ok: response.ok, body: await response.json() })),
        fetch(`/api/reconciliation/list?stationId=${encodeURIComponent(stationId)}`, { headers }).then(async (response) => ({ ok: response.ok, body: await response.json() })),
      ]);
      if (!openDataResult.ok) throw new Error(openDataResult.body?.error || 'تعذر تحميل بيانات فتح الجلسة');
      if (!sessionResult.ok) throw new Error(sessionResult.body?.error || 'تعذر تحميل جلسات التسوية');
      const rows = (openDataResult.body?.shifts || []) as ShiftOption[];
      const meterRows = (openDataResult.body?.meters || []) as MeterOption[];
      setShifts(rows); setShift((current) => current || rows[0]?.id || ''); setMeters(meterRows); setSessions(sessionResult.body?.sessions || []);
      setOperatorName(openDataResult.body?.user?.full_name || user?.email || 'المستخدم الحالي');
      setOpeningDate(openDataResult.body?.date || cairoBusinessDate());
      setOpeningTime(openDataResult.body?.time || new Date().toISOString());
    } catch (reason: any) { setError(reason.message || 'تعذر تحميل البيانات'); }
    finally { setLoading(false); }
  }, [stationId]);
  useEffect(() => { load(); }, [load]);
  const openSessions = useMemo(() => sessions.filter((item) => item.status === 'open'), [sessions]);
  const archivedSessions = useMemo(() => sessions.filter((item) => item.status !== 'open'), [sessions]);
  const availableShifts = shifts;
  useEffect(() => {
    if (!availableShifts.length) { setShift(''); return; }
    if (availableShifts.some((item) => item.id === shift)) return;
    setShift(availableShifts[0]!.id);
  }, [availableShifts, shift]);

  async function openSession(event: React.FormEvent) {
    event.preventDefault(); setMessage(null);
    if (!stationId) return setMessage('لا توجد محطة مرتبطة بهذا الحساب.');
    if (!shift) return setMessage('اختر وردية فعالة أولاً.');
    if (!meters.length) return setMessage('لا توجد عدادات تشغيلية مرتبطة بالخزانات. أضف عدادًا نشطًا قبل فتح الوردية.');
    const openingMeters = meters.map((item) => ({ meter_id: item.id, reading: Number(meterReadings[item.id]) }));
    if (openingMeters.some((item) => !Number.isFinite(item.reading) || item.reading < 0)) return setMessage('سجل قراءة بداية صحيحة لكل العدادات.');
    setOpening(true);
    try {
      const { data: authData } = await supabase.auth.getSession();
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (authData.session?.access_token) headers.Authorization = `Bearer ${authData.session.access_token}`;
      const response = await fetch('/api/reconciliation/open', { method: 'POST', headers, body: JSON.stringify({ station_id: stationId, shift_id: shift, opening_meters: openingMeters, opening_tanks: [] }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'تعذر فتح جلسة التسوية');
      setOpenFormVisible(false); setMeterReadings({}); await load();
    } catch (reason: any) { setMessage(reason.message || 'تعذر فتح الجلسة'); }
    finally { setOpening(false); }
  }

  return <PageLayout title="التسويات"><main className="reconciliation-page" dir="rtl">
    <div className="page-heading"><div><span className="eyebrow">إدارة الورديات</span><h2>التسويات اليومية</h2><p>تابع الجلسات المفتوحة وسجل الجلسات التي تم اعتمادها.</p></div></div>
    <section className="recon-stats"><article><small>الجلسات المفتوحة</small><b>{openSessions.length}</b><em>تحتاج قراءة واعتماداً</em></article><article><small>الجلسات المؤرشفة</small><b>{archivedSessions.length}</b><em>مغلقة ومتاحة للمراجعة</em></article><article><small>إجمالي الفروقات</small><b>{sessions.reduce((sum, item) => sum + Number(item.variance_value || 0), 0).toLocaleString('ar-EG')}</b><em>جنيه مصري</em></article></section>
    <div className="page-heading"><div /><button className="btn btn-primary" onClick={() => setOpenFormVisible((visible) => !visible)} disabled={openSessions.length > 0}>{openFormVisible ? 'إغلاق النموذج' : 'فتح جلسة'}</button></div>
    {openFormVisible && <section className="panel recon-open-form recon-dynamic-form"><div><b>نموذج فتح الجلسة</b><small>اختر أي وردية، ثم سجل قراءة بداية كل عداد. بعد إغلاقها يمكنك فتحها مرة أخرى بدورة جديدة في نفس اليوم.</small></div><form onSubmit={openSession}><div className="recon-opening-meta"><label>اسم المستخدم<input readOnly value={operatorName} /></label><label>التاريخ<input readOnly value={openingDate} /></label><label>وقت الفتح<input readOnly value={openingTime ? new Date(openingTime).toLocaleTimeString('ar-EG') : '—'} /></label></div><label>نوع الوردية<select required value={shift} onChange={(e) => setShift(e.target.value)} disabled={!availableShifts.length}><option value="">اختر الوردية</option>{availableShifts.map((item) => <option key={item.id} value={item.id}>{item.shift_period === 'morning' || (!item.shift_period && item.seq === 1) ? 'صباحية' : 'مسائية'}</option>)}</select></label><div className="recon-opening-grid single"><div><h4>قراءات العدادات والطلمبات</h4>{meters.map((item) => <label key={item.id}>{item.code} · {item.name}<input required min="0" step="0.001" type="number" value={meterReadings[item.id] || ''} onChange={(e) => setMeterReadings((current) => ({ ...current, [item.id]: e.target.value }))} placeholder="قراءة بداية العداد" /></label>)}</div></div><button className="btn btn-primary" disabled={opening || !stationId || !shift || !availableShifts.length || !meters.length}>{opening ? 'جارٍ إنشاء الجلسة…' : 'فتح الجلسة وحفظ القراءات'}</button></form></section>}
    {message && <div className="notice notice-warning">{message}</div>}
    {loading ? <LoadingState /> : error ? <ErrorState onRetry={load} /> : <>
      <section className="recon-section"><div className="recon-heading"><div><h3>الجلسات المفتوحة</h3><p>استكمل القراءات ثم أغلق الجلسة لتنتقل إلى السجل.</p></div><span>{openSessions.length}</span></div>{openSessions.length === 0 ? <EmptyState title="لا توجد جلسات مفتوحة" description="تظهر هنا الجلسات التي تحتاج إدخال القراءة واعتمادها." /> : <div className="recon-open-grid">{openSessions.map((item) => <article className="recon-session-card" key={item.id}><span className="recon-live">مفتوحة الآن</span><h4>{shiftLabel(item)}</h4><p>{item.business_date}</p><div><span>تم الفتح: {item.opened_at ? new Date(item.opened_at).toLocaleString('ar-EG') : '—'}</span><span>الفارق الحالي: {Number(item.variance_value || 0).toLocaleString('ar-EG')} ج.م</span></div><button className="btn btn-primary" onClick={() => router.push(`/reconciliation/session?sessionId=${encodeURIComponent(item.id)}`)}>متابعة الجلسة</button></article>)}</div>}</section>
      <section className="recon-section"><div className="recon-heading"><div><h3>سجل الجلسات المغلقة</h3><p>كل جلسة مغلقة تختفي من القائمة النشطة وتنتقل هنا للمراجعة فقط.</p></div><span>{archivedSessions.length}</span></div>{archivedSessions.length === 0 ? <EmptyState title="لا يوجد سجل مغلق بعد" description="ستظهر الجلسات هنا مباشرة بعد اعتماد وإغلاق التسوية." /> : <div className="panel recon-archive"><div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الوردية</th><th>الحالة</th><th>وقت الإغلاق</th><th>الفارق</th><th /></tr></thead><tbody>{archivedSessions.map((item) => <tr key={item.id}><td>{item.business_date}</td><td>{shiftLabel(item)}</td><td><span className="status-badge status-completed">{statusText(item.status)}</span></td><td>{item.submitted_at ? new Date(item.submitted_at).toLocaleString('ar-EG') : '—'}</td><td>{Number(item.variance_value || 0).toLocaleString('ar-EG')} ج.م</td><td><button className="btn btn-ghost btn-sm" onClick={() => router.push(`/reconciliation/session?sessionId=${encodeURIComponent(item.id)}`)}>عرض التفاصيل</button></td></tr>)}</tbody></table></div></div>}</section>
    </>}
  </main></PageLayout>;
}
