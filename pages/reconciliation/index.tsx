import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import PageLayout from '../../src/components/PageLayout';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/DataState';
import { useRequireAuth } from '../../src/lib/auth';
import { useCurrentStationId } from '../../src/lib/station';
import supabase from '../../src/lib/supabaseClient';

type ShiftOption = { id: string; code: string; name: string; seq: number };
type Session = { id: string; business_date: string; shift_code?: string; shift_name?: string; status: string; opened_at?: string; submitted_at?: string; variance_value?: number };
const today = () => new Date().toISOString().slice(0, 10);
const statusText = (value: string) => value === 'open' ? 'مفتوحة' : value === 'submitted' ? 'مغلقة' : value;

export default function ReconciliationIndex() {
  const router = useRouter();
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState('');
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    if (!stationId) { setSessions([]); setShifts([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [shiftResult, sessionResult] = await Promise.all([
        supabase.from('shifts').select('id, code, name, seq').eq('station_id', stationId).eq('is_active', true).order('seq'),
        fetch(`/api/reconciliation/list?stationId=${encodeURIComponent(stationId)}`).then(async (response) => ({ ok: response.ok, body: await response.json() })),
      ]);
      if (shiftResult.error) throw new Error(shiftResult.error.message);
      if (!sessionResult.ok) throw new Error(sessionResult.body?.error || 'تعذر تحميل جلسات التسوية');
      const rows = (shiftResult.data || []) as ShiftOption[];
      setShifts(rows); setShift((current) => current || rows[0]?.id || ''); setSessions(sessionResult.body?.sessions || []);
    } catch (reason: any) { setError(reason.message || 'تعذر تحميل البيانات'); }
    finally { setLoading(false); }
  }, [stationId]);
  useEffect(() => { load(); }, [load]);
  const openSessions = useMemo(() => sessions.filter((item) => item.status === 'open'), [sessions]);
  const archivedSessions = useMemo(() => sessions.filter((item) => item.status !== 'open'), [sessions]);

  async function openSession(event: React.FormEvent) {
    event.preventDefault(); setMessage(null);
    if (!stationId) return setMessage('لا توجد محطة مرتبطة بهذا الحساب.');
    if (!shift) return setMessage('اختر وردية فعالة أولاً.');
    setOpening(true);
    try {
      const response = await fetch('/api/reconciliation/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station_id: stationId, business_date: date, shift_id: shift }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'تعذر فتح جلسة التسوية');
      await router.push(`/reconciliation/session?sessionId=${encodeURIComponent(body.result)}`);
    } catch (reason: any) { setMessage(reason.message || 'تعذر فتح الجلسة'); }
    finally { setOpening(false); }
  }

  return <PageLayout title="التسويات"><main className="reconciliation-page" dir="rtl">
    <div className="page-heading"><div><span className="eyebrow">إدارة الورديات</span><h2>التسويات اليومية</h2><p>تابع الجلسات المفتوحة وسجل الجلسات التي تم اعتمادها.</p></div></div>
    <section className="recon-stats"><article><small>الجلسات المفتوحة</small><b>{openSessions.length}</b><em>تحتاج قراءة واعتماداً</em></article><article><small>الجلسات المؤرشفة</small><b>{archivedSessions.length}</b><em>مغلقة ومتاحة للمراجعة</em></article><article><small>إجمالي الفروقات</small><b>{sessions.reduce((sum, item) => sum + Number(item.variance_value || 0), 0).toLocaleString('ar-EG')}</b><em>جنيه مصري</em></article></section>
    <section className="panel recon-open-form"><div><b>فتح جلسة تسوية</b><small>تُفتح تلقائياً عند أول حركة بيع أو مخزون، ويمكن فتحها يدوياً عند الحاجة.</small></div><form onSubmit={openSession}><label>التاريخ<input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><label>الوردية<select value={shift} onChange={(e) => setShift(e.target.value)} disabled={!shifts.length}>{shifts.length ? shifts.map((item) => <option key={item.id} value={item.id}>{item.name || item.code}</option>) : <option value="">لا توجد ورديات</option>}</select></label><button className="btn btn-primary" disabled={opening || !stationId || !shift}>{opening ? 'جارٍ الفتح…' : 'فتح جلسة'}</button></form></section>
    {message && <div className="notice notice-warning">{message}</div>}
    {loading ? <LoadingState /> : error ? <ErrorState onRetry={load} /> : <>
      <section className="recon-section"><div className="recon-heading"><div><h3>الجلسات المفتوحة</h3><p>استكمل القراءات ثم أغلق الجلسة لتنتقل إلى السجل.</p></div><span>{openSessions.length}</span></div>{openSessions.length === 0 ? <EmptyState title="لا توجد جلسات مفتوحة" description="تظهر هنا الجلسات التي تحتاج إدخال القراءة واعتمادها." /> : <div className="recon-open-grid">{openSessions.map((item) => <article className="recon-session-card" key={item.id}><span className="recon-live">مفتوحة الآن</span><h4>{item.shift_name || item.shift_code || 'وردية'}</h4><p>{item.business_date}</p><div><span>تم الفتح: {item.opened_at ? new Date(item.opened_at).toLocaleString('ar-EG') : '—'}</span><span>الفارق الحالي: {Number(item.variance_value || 0).toLocaleString('ar-EG')} ج.م</span></div><button className="btn btn-primary" onClick={() => router.push(`/reconciliation/session?sessionId=${encodeURIComponent(item.id)}`)}>متابعة الجلسة</button></article>)}</div>}</section>
      <section className="recon-section"><div className="recon-heading"><div><h3>سجل الجلسات المغلقة</h3><p>كل جلسة مغلقة تختفي من القائمة النشطة وتنتقل هنا للمراجعة فقط.</p></div><span>{archivedSessions.length}</span></div>{archivedSessions.length === 0 ? <EmptyState title="لا يوجد سجل مغلق بعد" description="ستظهر الجلسات هنا مباشرة بعد اعتماد وإغلاق التسوية." /> : <div className="panel recon-archive"><div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الوردية</th><th>الحالة</th><th>وقت الإغلاق</th><th>الفارق</th><th /></tr></thead><tbody>{archivedSessions.map((item) => <tr key={item.id}><td>{item.business_date}</td><td>{item.shift_name || item.shift_code || '—'}</td><td><span className="status-badge status-completed">{statusText(item.status)}</span></td><td>{item.submitted_at ? new Date(item.submitted_at).toLocaleString('ar-EG') : '—'}</td><td>{Number(item.variance_value || 0).toLocaleString('ar-EG')} ج.م</td><td><button className="btn btn-ghost btn-sm" onClick={() => router.push(`/reconciliation/session?sessionId=${encodeURIComponent(item.id)}`)}>عرض التفاصيل</button></td></tr>)}</tbody></table></div></div>}</section>
    </>}
  </main></PageLayout>;
}
