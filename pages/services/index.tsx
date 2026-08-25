import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import PageLayout from '../../src/components/PageLayout';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/DataState';
import { useRequireAuth } from '../../src/lib/auth';
import { useCurrentStationId } from '../../src/lib/station';
import supabase from '../../src/lib/supabaseClient';
import { formatMoney as formatMoneyValue } from '../../src/core/numbers';

type Service = { id: string; service_type: string; service_name?: string; vehicle_type?: string; amount: number; created_at: string; created_by_name?: string; status?: string; business_date?: string };
const labels: Record<string, string> = { car_wash: 'غسيل سيارة', oil_change: 'تغيير زيت', carpet_wash: 'غسيل سجاد', blanket_wash: 'غسيل بطانية', other: 'أخرى' };
const money = (value: unknown) => formatMoneyValue(value).replace(/ جنيه$/, '');

export default function ServicesPage() {
  const { user } = useRequireAuth();
  const router = useRouter();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [services, setServices] = useState<Service[]>([]);
  const [session, setSession] = useState<any>(null);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(async () => {
    if (!stationId) return;
    setState('loading');
    try {
      const { data: authData } = await supabase.auth.getSession();
      const headers: HeadersInit = authData.session?.access_token ? { Authorization: `Bearer ${authData.session.access_token}` } : {};
      const response = await fetch(`/api/services/list?stationId=${encodeURIComponent(stationId)}`, { headers });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'تعذر تحميل الخدمات.');
      setServices(body.services || []); setSession(body.session || null); setTotal(Number(body.total || 0)); setState('ready');
    } catch { setState('error'); }
  }, [stationId]);
  useEffect(() => { if (stationId) load(); }, [stationId, load]);
  return <PageLayout title="الخدمات"><main dir="rtl" className="page-shell"><div className="page-heading"><div><span className="eyebrow">الجلسة الحالية</span><h2>الخدمات</h2><p>{session ? `خدمات الوردية المفتوحة · ${session.business_date}` : 'لا توجد جلسة مفتوحة حاليًا.'}</p></div><Link className="ui-button" href="/services/new">+ إضافة خدمة</Link></div><section className="ui-card mb-5"><div className="ui-toolbar"><b>إجمالي خدمات الجلسة</b><strong>{money(total)} ج.م</strong><span className="status-badge">{services.length} خدمة</span></div></section>{state === 'loading' ? <LoadingState /> : state === 'error' ? <ErrorState onRetry={load} /> : services.length === 0 ? <EmptyState title={session ? 'لا توجد خدمات في الجلسة' : 'لا توجد جلسة مفتوحة'} description={session ? 'ستظهر الخدمات هنا بعد تنفيذها.' : 'افتح وردية جديدة قبل تسجيل خدمة.'} /> : <section className="ui-card"><div className="table-scroll"><table className="data-table"><thead><tr><th>رقم الخدمة</th><th>نوع الخدمة</th><th>نوع السيارة</th><th>المبلغ</th><th>التاريخ والوقت</th><th>المستخدم</th><th>الحالة</th></tr></thead><tbody>{services.map((service) => <tr key={service.id} onClick={() => router.push(`/services/${service.id}`)} className="cursor-pointer"><td><b>#{service.id.slice(0, 8)}</b></td><td><b>{labels[service.service_type] || service.service_type}</b>{service.service_name && <small className="block text-[var(--text-muted)]">{service.service_name}</small>}</td><td>{service.vehicle_type || 'لا ينطبق'}</td><td>{money(service.amount)} ج.م</td><td>{new Date(service.created_at).toLocaleString('ar-EG')}</td><td>{service.created_by_name || '—'}</td><td><span className="status-badge">{service.status === 'active' ? 'منفذة' : service.status || '—'}</span></td></tr>)}</tbody></table></div></section>}</main></PageLayout>;
}
