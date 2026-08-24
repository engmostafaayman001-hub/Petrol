import React, { useEffect, useState } from 'react';
import PageLayout from '../../src/components/PageLayout';
import { useRequireAuth } from '../../src/lib/auth';
import { useCurrentStationId } from '../../src/lib/station';
import supabase from '../../src/lib/supabaseClient';

export default function AdjustmentsList() {
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    if (!stationId) return;
    supabase.auth.getSession().then(({ data }: { data: { session: { access_token?: string } | null } }) => fetch(`/api/adjustments/list?stationId=${encodeURIComponent(stationId)}`, { headers: data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {} }))
      .then((response: Response) => response.json())
      .then((data: { adjustments?: any[] }) => setRows(data.adjustments || []))
      .catch(() => {});
  }, [stationId]);

  async function review(id: string, approve: boolean) {
    const { data: auth } = await supabase.auth.getSession();
    const res = await fetch('/api/adjustments/review', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth.session?.access_token ? { Authorization: `Bearer ${auth.session.access_token}` } : {}) }, body: JSON.stringify({ id, approved: approve }) });
    const b = await res.json();
    if (!res.ok) alert(b.error || 'فشل'); else {
      alert('تمت العملية');
      setRows((r) => r.map((it) => (it.id === id ? { ...it, status: approve ? 'approved' : 'rejected' } : it)));
    }
  }

  return (
    <PageLayout title="التعديلات">
      <h2 className="text-xl font-semibold mb-4 text-right">قائمة التعديلات</h2>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="p-3 bg-surface rounded shadow-sm text-right">
            <div className="font-medium">{r.tank_code ?? r.tank_id} · {r.reason}</div>
            <div className="text-sm text-muted">الكمية: {r.quantity} لتر · الحالة: {r.status ?? 'pending'}</div>
            <div className="mt-2 flex gap-2 justify-end">
              <button onClick={() => review(r.id, true)} className="bg-primary text-white px-3 py-1 rounded">موافقة</button>
              <button onClick={() => review(r.id, false)} className="bg-slate-300 text-slate-800 px-3 py-1 rounded">رفض</button>
            </div>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
