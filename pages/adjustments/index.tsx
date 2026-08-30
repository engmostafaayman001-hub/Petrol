import React, { useEffect, useState } from 'react';
import PageLayout from '../../src/components/PageLayout';
import { useRequireAuth } from '../../src/lib/auth';
import { useCurrentStationId } from '../../src/lib/station';
import supabase from '../../src/lib/supabaseClient';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/DataState';

export default function AdjustmentsList() {
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [rows, setRows] = useState<any[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  async function load() {
    if (!stationId) return;
    setState('loading');
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(`/api/adjustments/list?stationId=${encodeURIComponent(stationId)}`, { headers: data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {} });
      if (!response.ok) throw new Error('تعذر تحميل التسويات.');
      const body = await response.json();
      setRows(body.adjustments || []);
      setState('ready');
    } catch { setState('error'); }
  }

  useEffect(() => {
    load();
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
      {state === 'loading' ? <LoadingState /> : state === 'error' ? <ErrorState onRetry={load} /> : rows.length === 0 ? <EmptyState title="لا توجد تسويات" description="ستظهر طلبات التسوية هنا عند إنشائها." /> : <div className="space-y-2">
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
      </div>}
    </PageLayout>
  );
}
