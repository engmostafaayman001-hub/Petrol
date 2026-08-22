import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import PageLayout from '../../src/components/PageLayout';
import { useRequireAuth } from '../../src/lib/auth';
import { useCurrentStationId } from '../../src/lib/station';
import supabase from '../../src/lib/supabaseClient';

const labels: Record<string, string> = { car_wash: 'غسيل سيارة', oil_change: 'تغيير زيت', carpet_wash: 'غسيل سجاد', blanket_wash: 'غسيل بطانية', other: 'أخرى' };

export default function ServiceReceipt() {
  const { user } = useRequireAuth();
  const router = useRouter();
  const stationId = useCurrentStationId(user?.id ?? null);
  const serviceId = typeof router.query.id === 'string' ? router.query.id : '';
  const [service, setService] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!stationId || !serviceId) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(`/api/services/detail?stationId=${encodeURIComponent(stationId)}&serviceId=${encodeURIComponent(serviceId)}`, { headers: data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {} });
      const body = await response.json();
      if (!response.ok) setError(body.error || 'تعذر تحميل الفاتورة.');
      else setService(body.service);
    })();
  }, [stationId, serviceId]);

  useEffect(() => { if (service && router.query.autoPrint === '1') window.setTimeout(() => window.print(), 250); }, [service, router.query.autoPrint]);

  if (error) return <PageLayout title="فاتورة الخدمة"><div className="empty-state"><h3>تعذر فتح الفاتورة</h3><p>{error}</p><button className="ui-button" onClick={() => router.push('/services')}>العودة للخدمات</button></div></PageLayout>;
  if (!service) return <PageLayout title="فاتورة الخدمة"><div className="empty-state"><p>جارٍ تحميل الفاتورة…</p></div></PageLayout>;

  return <PageLayout title="فاتورة الخدمة"><main dir="rtl" className="page-shell"><div className="no-print page-heading"><div><span className="eyebrow">الخدمات</span><h2>فاتورة الخدمة #{service.id.slice(0, 8)}</h2><p>تفاصيل الخدمة المسجلة في الجلسة الحالية.</p></div><div className="flex gap-2"><button className="ui-button" onClick={() => window.print()}>طباعة الفاتورة</button><button className="ui-button secondary" onClick={() => router.push('/services')}>العودة</button></div></div><article className="service-receipt ui-card"><header><h1>{service.station_name || 'التعاون'}</h1><p>إيصال خدمة</p></header><dl><div><dt>رقم الخدمة</dt><dd>#{service.id.slice(0, 8)}</dd></div><div><dt>نوع الخدمة</dt><dd>{labels[service.service_type] || service.service_type}</dd></div>{service.service_name && <div><dt>اسم الخدمة</dt><dd>{service.service_name}</dd></div>}<div><dt>نوع السيارة</dt><dd>{service.vehicle_type || 'لا ينطبق'}</dd></div><div><dt>المبلغ</dt><dd>{Number(service.amount).toLocaleString('ar-EG', { minimumFractionDigits: 2 })} ج.م</dd></div><div><dt>التاريخ والوقت</dt><dd>{new Date(service.created_at).toLocaleString('ar-EG')}</dd></div><div><dt>الجلسة / الوردية</dt><dd>{service.session_id?.slice(0, 8)} · {service.business_date}</dd></div><div><dt>المستخدم</dt><dd>{service.created_by_name || '—'}</dd></div></dl><footer>شكرًا لاستخدامكم خدمات التعاون</footer></article></main></PageLayout>;
}
