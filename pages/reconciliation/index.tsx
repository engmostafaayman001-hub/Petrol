import React, { useEffect, useState } from 'react';
import PageLayout from '../../src/components/PageLayout';
import { useRequireAuth } from '../../src/lib/auth';
import { useCurrentStationId } from '../../src/lib/station';
import supabase from '../../src/lib/supabaseClient';

type ShiftOption = { id: string; code: string; name: string; seq: number };

export default function ReconciliationIndex() {
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [date, setDate] = useState<string>('');
  const [shift, setShift] = useState<string>('');
  const [availableShifts, setAvailableShifts] = useState<ShiftOption[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!stationId) {
      setSessions([]);
      setAvailableShifts([]);
      setShift('');
      return;
    }

    supabase
      .from('shifts')
      .select('id, code, name, seq')
      .eq('station_id', stationId)
      .eq('is_active', true)
      .order('seq', { ascending: true })
      .then((result: { data: ShiftOption[] | null; error: { message?: string } | null }) => {
        const rows = (result.data || []) as ShiftOption[];
        setAvailableShifts(rows);
        if (rows.length > 0) {
          const firstShiftId = rows[0]?.id;
          if (firstShiftId) {
            setShift((current) => current || firstShiftId);
          }
        }
      });

    fetch(`/api/reconciliation/list?stationId=${encodeURIComponent(stationId)}`)
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions || []))
      .catch(() => setSessions([]));
  }, [stationId]);

  async function openSession(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!stationId) {
      setMessage('لا توجد محطة مرتبطة بهذا الحساب');
      return;
    }

    if (!shift) {
      setMessage('لا توجد وردية فعالة لهذه المحطة');
      return;
    }

    const res = await fetch('/api/reconciliation/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_id: stationId, business_date: date, shift_id: shift }),
    });

    const body = await res.json();
    if (!res.ok) {
      setMessage(body?.error || 'فشل فتح الجلسة');
      return;
    }

    setMessage('تم فتح الجلسة');
    fetch(`/api/reconciliation/list?stationId=${encodeURIComponent(stationId)}`)
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions || []))
      .catch(() => setSessions([]));
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
            {availableShifts.length === 0 ? <option value="">لا توجد ورديات</option> : availableShifts.map((item) => (
              <option key={item.id} value={item.id}>{item.name || item.code}</option>
            ))}
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
