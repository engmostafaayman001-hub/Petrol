import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import PageLayout from '../../src/components/PageLayout';
import FormField from '../../src/components/FormField';
import { useRequireAuth } from '../../src/lib/auth';
import { useCurrentStationId } from '../../src/lib/station';
import supabase from '../../src/lib/supabaseClient';

type ExtraSale = { id: string; invoice_number: string; station_owner_name: string; seller_station_name?: string | null; buyer_name?: string | null; item_name?: string | null; net_amount?: number | null; tax_number?: string | null; commercial_registration_number?: string | null; registration_number?: string | null; email?: string | null; phone?: string | null; sale_description: string; amount: number; created_at: string };
type FormState = Omit<ExtraSale, 'id' | 'invoice_number' | 'amount' | 'created_at'> & { amount: string };
const blank: FormState = { station_owner_name: '', tax_number: '', commercial_registration_number: '', registration_number: '', email: '', phone: '', sale_description: '', amount: '' };

export default function ExtraSalesPage() {
  const { user } = useRequireAuth();
  const router = useRouter();
  const stationId = useCurrentStationId(user?.id ?? null);
    const [sales, setSales] = useState<ExtraSale[]>([]); 
    const [form, setForm] = useState<FormState>(blank); 
    const [open, setOpen] = useState(false); 
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!stationId) return;
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(`/api/extra-sales?stationId=${encodeURIComponent(stationId)}`, { headers: data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {} });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'تعذر تحميل المبيعات الإضافية.');
      setSales(body.sales || []);
    } catch (error: any) { setMessage(error.message || 'تعذر تحميل البيانات.'); }
    finally { setLoading(false); }
  }, [stationId]);
  useEffect(() => { load(); }, [load]);
  function update(field: keyof FormState, value: string) { setForm((current) => ({ ...current, [field]: value })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!stationId) return setMessage('لا توجد محطة مرتبطة بهذا الحساب.');
    setSaving(true); setMessage('');
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch('/api/extra-sales', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}) }, body: JSON.stringify({ station_id: stationId, ...form, amount: Number(form.amount) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'تعذر حفظ العملية.');
      setOpen(false); setForm(blank); await load(); router.push(`/extra-sales/${body.sale.id}`);
    } catch (error: any) { setMessage(error.message || 'تعذر حفظ العملية.'); }
    finally { setSaving(false); }
  }
  return <PageLayout title="مبيعات إضافية" description="فواتير إلكترونية مستقلة لا تؤثر على حركة المحطة.">
    <main className="extra-sales-page">
      <div className="page-heading"><div><span className="eyebrow">فواتير مستقلة</span><h2>مبيعات إضافية</h2><p>أنشئ فاتورة إلكترونية واحفظ تفاصيلها للطباعة، دون خصم أو احتساب تشغيلي.</p></div><button className="ui-button" onClick={() => router.push('/extra-sales/new')}>+ إضافة عملية بيع</button></div>
      {message && <div className="form-error" role="alert">{message}</div>}
      <section className="ui-card extra-sales-list"><div className="ui-toolbar"><div><b>العمليات المنفذة</b><small>{sales.length} فاتورة محفوظة</small></div></div>{loading ? <div className="empty-state"><p>جارٍ تحميل الفواتير…</p></div> : sales.length === 0 ? <div className="empty-state"><h3>لا توجد مبيعات إضافية</h3><p>ابدأ بإضافة أول فاتورة إلكترونية.</p></div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>رقم الفاتورة</th><th>اسم البائع</th><th>اسم المشتري</th><th>اسم الصنف</th><th>صافي المبلغ</th><th>التاريخ</th><th>الإجراء</th></tr></thead><tbody>{sales.map((sale) => <tr key={sale.id}><td data-label="رقم الفاتورة"><b>{sale.invoice_number}</b></td><td data-label="اسم البائع">{sale.seller_station_name || sale.station_owner_name}</td><td data-label="اسم المشتري">{sale.buyer_name || '—'}</td><td data-label="اسم الصنف">{sale.item_name || sale.sale_description}</td><td data-label="صافي المبلغ">{Number(sale.net_amount ?? sale.amount).toLocaleString('ar-EG', { minimumFractionDigits: 2 })} ج.م</td><td data-label="التاريخ">{new Date(sale.created_at).toLocaleString('ar-EG')}</td><td data-label="الإجراء"><button className="ui-button secondary" onClick={() => router.push(`/extra-sales/${sale.id}`)}>التفاصيل والطباعة</button></td></tr>)}</tbody></table></div>}</section>
      {open && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="extra-sale-title" onMouseDown={() => setOpen(false)}><section className="ui-card modal-card extra-sale-modal" onMouseDown={(event) => event.stopPropagation()}><div className="recon-modal-heading"><div><b id="extra-sale-title">إضافة عملية بيع</b><small>بيانات الفاتورة الإلكترونية فقط</small></div><button type="button" className="modal-close" aria-label="إغلاق" onClick={() => setOpen(false)}>×</button></div><form onSubmit={submit} className="form-grid"><FormField label="اسم صاحب المحطة"><input required value={form.station_owner_name} onChange={(event) => update('station_owner_name', event.target.value)} placeholder="الاسم بالكامل" /></FormField><FormField label="الرقم الضريبي"><input value={form.tax_number || ''} onChange={(event) => update('tax_number', event.target.value)} /></FormField><FormField label="رقم السجل التجاري"><input value={form.commercial_registration_number || ''} onChange={(event) => update('commercial_registration_number', event.target.value)} /></FormField><FormField label="رقم التسجيل"><input value={form.registration_number || ''} onChange={(event) => update('registration_number', event.target.value)} /></FormField><FormField label="البريد الإلكتروني"><input type="email" value={form.email || ''} onChange={(event) => update('email', event.target.value)} /></FormField><FormField label="رقم الهاتف"><input type="tel" value={form.phone || ''} onChange={(event) => update('phone', event.target.value)} /></FormField><div className="form-field-full"><FormField label="تفاصيل البيع"><textarea required value={form.sale_description} onChange={(event) => update('sale_description', event.target.value)} placeholder="وصف المنتج أو الخدمة" /></FormField></div><FormField label="المبلغ المدخل"><input required min="0" step="0.01" type="number" value={form.amount} onChange={(event) => update('amount', event.target.value)} placeholder="0.00" /></FormField><div className="form-actions form-field-full"><button className="ui-button" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ الفاتورة'}</button><button type="button" className="ui-button secondary" onClick={() => setOpen(false)}>إلغاء</button></div></form></section></div>}
    </main>
  </PageLayout>;
}
