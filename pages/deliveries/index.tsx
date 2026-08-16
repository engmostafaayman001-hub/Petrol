import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import PageLayout from '../../src/components/PageLayout';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/DataState';
import { useRequireAuth } from '../../src/lib/auth';
import { useCurrentStationId } from '../../src/lib/station';
type Delivery = { id: string; business_date?: string; tank_code?: string; fuel_name?: string; supplier_name?: string; quantity?: number; total_cost?: number };
export default function DeliveriesList() {
  const { user } = useRequireAuth(); const stationId = useCurrentStationId(user?.id ?? null); const [rows, setRows] = useState<Delivery[]>([]); const [state, setState] = useState<'loading'|'ready'|'error'>('loading');
  const load = useCallback(async () => { if (!stationId) return; setState('loading'); try { const r = await fetch(`/api/deliveries/list?stationId=${encodeURIComponent(stationId)}`); if (!r.ok) throw new Error(); const d = await r.json(); setRows(d.deliveries || []); setState('ready'); } catch { setState('error'); } }, [stationId]); useEffect(() => { if (stationId) load(); }, [stationId, load]);
  return <PageLayout title="التوريدات"><div className="page-heading"><div><h2>سجل التوريدات</h2><p>مراجعة كميات الوقود الواردة إلى المحطة.</p></div><Link className="ui-button" href="/deliveries/new">تسجيل توريد</Link></div><section className="ui-card"><div className="ui-toolbar"><b>التوريدات الأخيرة</b><span className="status-badge">{rows.length} عملية</span></div>{state === 'loading' ? <LoadingState /> : state === 'error' ? <ErrorState onRetry={load} /> : rows.length === 0 ? <EmptyState title="لا توجد توريدات حتى الآن" description="سجل أول توريد لعرضه هنا." /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>التاريخ</th><th>الوقود والخزان</th><th>المورد</th><th>الكمية</th><th>التكلفة</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td>{r.business_date || '—'}</td><td><b>{r.fuel_name || '—'}</b><small className="block text-[var(--text-muted)]">{r.tank_code || '—'}</small></td><td>{r.supplier_name || '—'}</td><td>{r.quantity ?? '—'} لتر</td><td>{Number(r.total_cost ?? 0).toLocaleString('ar-EG')} ج.م</td></tr>)}</tbody></table></div>}</section></PageLayout>;
}
