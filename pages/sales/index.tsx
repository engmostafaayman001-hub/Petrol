import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import PageLayout from '../../src/components/PageLayout';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/DataState';
import { useRequireAuth } from '../../src/lib/auth';
type Sale = { id: string; business_date?: string; tank_code?: string; quantity?: number; status?: string };
export default function SalesList() {
  useRequireAuth(); const [rows, setRows] = useState<Sale[]>([]); const [state, setState] = useState<'loading'|'ready'|'error'>('loading');
  const load = useCallback(async () => { setState('loading'); try { const r = await fetch('/api/sales/list'); if (!r.ok) throw new Error(); const d = await r.json(); setRows(d.sales || []); setState('ready'); } catch { setState('error'); } }, []);
  useEffect(() => { load(); }, [load]);
  return <PageLayout title="المبيعات"><div className="page-heading"><div><h2>سجل المبيعات</h2><p>تابع عمليات بيع الوقود المسجلة في المحطة.</p></div><Link className="ui-button" href="/sales/new">تسجيل بيع</Link></div><section className="ui-card"><div className="ui-toolbar"><b>العمليات الأخيرة</b><span className="status-badge">{rows.length} عملية</span></div>{state === 'loading' ? <LoadingState /> : state === 'error' ? <ErrorState onRetry={load} /> : rows.length === 0 ? <EmptyState title="لا توجد مبيعات حتى الآن" description="ستظهر عمليات البيع المسجلة هنا." /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>التاريخ</th><th>الخزان</th><th>الكمية</th><th>الحالة</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td>{r.business_date || '—'}</td><td>{r.tank_code || '—'}</td><td>{r.quantity ?? '—'} لتر</td><td><span className="status-badge">{r.status || 'مسجلة'}</span></td></tr>)}</tbody></table></div>}</section></PageLayout>;
}
