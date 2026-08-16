// @ts-nocheck
import React, { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import PageLayout from '../../src/components/PageLayout';
import supabase from '../../src/lib/supabaseClient';
import { useRequireAuth } from '../../src/lib/auth';
import { useCurrentStationId } from '../../src/lib/station';

const fields = [['اسم المحطة', 'name'], ['كود المحطة', 'code'], ['الاسم القانوني', 'legal_name'], ['العنوان', 'address'], ['المدينة', 'city'], ['المنطقة الزمنية', 'timezone'], ['العملة', 'currency_code']];

export default function StationSettings() {
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [form, setForm] = useState<any>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!stationId) {
      setForm(null);
      return;
    }

    supabase.from('stations').select('id,code,name,legal_name,address,city,timezone,currency_code').eq('id', stationId).single().then(({ data }) => setForm(data));
  }, [stationId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!stationId || !form) {
      setMessage('لا توجد محطة مرتبطة بهذا الحساب.');
      return;
    }

    const { error } = await supabase.from('stations').update(form).eq('id', stationId);
    setMessage(error ? 'تعذر حفظ إعدادات المحطة.' : 'تم حفظ إعدادات المحطة.');
  }

  if (!form) return <PageLayout title="إعدادات المحطة"><div className="empty-state"><p>جارٍ تحميل بيانات المحطة…</p></div></PageLayout>;

  return <PageLayout title="إعدادات المحطة"><div className="page-heading"><div><h2>بيانات المحطة</h2><p>الاسم والموقع والتفضيلات الأساسية للمحطة.</p></div><Link className="ui-button secondary" href="/settings">العودة للإعدادات</Link></div><form onSubmit={submit} className="ui-card form-card form-grid">{fields.map(([label, key]) => <div className="form-field" key={String(key)}><label>{label}</label><input value={form[key] || ''} onChange={e => setForm({ ...form, [key]: e.target.value })} /></div>)}{message && <p className="text-sm text-[var(--text-muted)]">{message}</p>}<button className="ui-button">حفظ الإعدادات</button></form></PageLayout>;
}
