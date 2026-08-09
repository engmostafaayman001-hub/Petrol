import React, { useEffect, useState } from 'react';
import PageLayout from '../../src/components/PageLayout';
import { useRequireAuth } from '../../src/lib/auth';

const DEMO_STATION = (process.env.NEXT_PUBLIC_DEMO_STATION_ID || '11111111-1111-4111-8111-111111111111').trim();

export default function ReconciliationIndex() {
  useRequireAuth();
  const [sessions, setSessions] = useState<any[]>([]);
  const [date, setDate] = useState<string>('');
  const [shift, setShift] = useState<string>('morning');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/reconciliation/list?stationId=' + DEMO_STATION)
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions || []))
      .catch(() => {});
  }, []);

  async function openSession(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch('/api/reconciliation/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station_id: DEMO_STATION, business_date: date, shift_id: shift }) });
    const body = await res.json();
    if (!res.ok) setMessage(body.error || 'فشل'); else setMessage('تم فتح الجلسة');
    // refresh
    fetch('/api/reconciliation/list?stationId=' + DEMO_STATION).then((r) => r.json()).then((d) => setSessions(d.sessions || [])).catch(() => {});
  }

  return (
    <PageLayout title="التسوية">
      <h2 className="text-xl font-semibold mb-4 text-right">جلسات التسوية</h2>
      <form onSubmit={openSession} className="max-w-md mb-6 text-right space-y-3">
        <div>
          <label className="block text-right">تاريخ الجلسة</label>
          <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label className="block text-right">الوردية</label>
          <select value={shift} onChange={(e) => setShift(e.target.value)} className="w-full border rounded px-3 py-2">
            <option value="morning">صباحية</option>
            <option value="evening">مسائية</option>
          </select>
        </div>
        <div className="text-right">
          <button className="bg-primary text-white px-4 py-2 rounded">فتح جلسة جديدة</button>
        </div>
        {message && <div className="text-sm text-muted">{message}</div>}
      </form>

      <div className="space-y-3">
        {sessions.length === 0 && <div className="text-sm text-muted">لا توجد جلسات.</div>}
        {sessions.map((s) => (
          <div key={s.id} className="p-3 bg-surface rounded shadow-sm flex items-center justify-between">
            <div className="text-right">
              <div className="font-medium">{s.business_date} · {s.shift_code}</div>
              <div className="text-sm text-muted">الحالة: {s.status}</div>
            </div>
            <div>
              <a className="text-primary underline" href={'/reconciliation/session?sessionId=' + s.id}>فتح</a>
            </div>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
