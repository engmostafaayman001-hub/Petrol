import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import PageLayout from '../../src/components/PageLayout';
import { useRequireAuth } from '../../src/lib/auth';
import FormField from '../../src/components/FormField';
import { useCurrentStationId } from '../../src/lib/station';
import supabase from '../../src/lib/supabaseClient';
import { formatMoney, multiplyMoney, parseNumericInput } from '../../src/core/numbers';
import { ErrorState, LoadingState } from '../../src/components/DataState';

const cairoDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

export default function NewDelivery() {
  const { user } = useRequireAuth();
  const router = useRouter();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [tanks, setTanks] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: '', code: '', contact_name: '', contact_phone: '', notes: '' });
  const [form, setForm] = useState<any>({ station_id: '', tank_id: '', business_date: cairoDate(), supplier_id: '', quantity: '', unit_cost: '', paid_amount: '', reference_no: '', notes: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!stationId) {
      setTanks([]);
      setLoadingData(true);
      return;
    }

    setLoadingData(true); setLoadFailed(false);
    setForm((current: any) => ({ ...current, station_id: stationId }));
    supabase.auth.getSession().then(async ({ data }: { data: { session: { access_token?: string } | null } }) => {
      const headers: Record<string, string> = data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
      try {
        const [tanksResponse, suppliersResponse] = await Promise.all([fetch(`/api/tanks?stationId=${encodeURIComponent(stationId)}`, { headers }), fetch(`/api/suppliers?stationId=${encodeURIComponent(stationId)}`, { headers })]);
        if (!tanksResponse.ok || !suppliersResponse.ok) throw new Error();
        const [tanksData, suppliersData] = await Promise.all([tanksResponse.json(), suppliersResponse.json()]);
        setTanks(tanksData.tanks || []); setSuppliers(suppliersData.suppliers || []);
      } catch { setTanks([]); setSuppliers([]); setLoadFailed(true); }
      finally { setLoadingData(false); }
    });
  }, [stationId]);

  function update(k: string, v: any) { setForm((s: any) => ({ ...s, [k]: v })); }

  async function addSupplier(event: React.FormEvent) {
    event.preventDefault();
    if (!stationId || supplierForm.name.trim().length < 2 || supplierForm.code.trim().length < 2) { setMessage('أدخل اسم المورد والكود قبل الحفظ.'); return; }
    const { data: auth } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth.session?.access_token) headers.Authorization = `Bearer ${auth.session.access_token}`;
    const response = await fetch('/api/suppliers', { method: 'POST', headers, body: JSON.stringify({ station_id: stationId, ...supplierForm }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(body.error || 'تعذر إضافة المورد.'); return; }
    const supplier = body.supplier;
    setSuppliers((current) => [...current, supplier].sort((a, b) => a.name.localeCompare(b.name, 'ar')));
    update('supplier_id', supplier.id); setSupplierForm({ name: '', code: '', contact_name: '', contact_phone: '', notes: '' }); setSupplierFormOpen(false); setMessage('تمت إضافة المورد واختياره تلقائيًا.');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setMessage(null);

    const stationIdValue = (form.station_id || stationId || '').trim();
    const quantity = parseNumericInput(form.quantity) ?? NaN;
    const unitCost = parseNumericInput(form.unit_cost) ?? NaN;
    const paidAmount = parseNumericInput(form.paid_amount || 0) ?? NaN;

    if (!stationIdValue || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(stationIdValue)) {
      setMessage('معرف المحطة غير صالح');
      return;
    }

    if (!form.tank_id) {
      setMessage('اختر الخزان.');
      return;
    }
    if (!form.supplier_id) {
      setMessage('اختر المورد.');
      return;
    }
    if (!form.business_date) {
      setMessage('أدخل تاريخ العملية.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setMessage('أدخل كمية صحيحة أكبر من صفر.');
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      setMessage('أدخل سعر الوحدة بصيغة صحيحة، مثل 20.62.86.');
      return;
    }
    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      setMessage('أدخل قيمة المدفوع بشكل صحيح.');
      return;
    }
    const total = multiplyMoney(quantity, unitCost);
    if (paidAmount > total) {
      setMessage(`المدفوع لا يمكن أن يتجاوز إجمالي التوريد (${formatMoney(total)}).`);
      return;
    }

    const payload = { station_id: stationIdValue, tank_id: form.tank_id, fuel_type_id: form.fuel_type_id || undefined, business_date: form.business_date, supplier_id: form.supplier_id, quantity, unit_cost: unitCost, paid_amount: paidAmount, reference_no: form.reference_no || undefined, notes: form.notes || undefined };
    const { data: auth } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth.session?.access_token) headers.Authorization = `Bearer ${auth.session.access_token}`;
    setSaving(true);
    try {
      const res = await fetch('/api/deliveries/create', { method: 'POST', headers, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage([body.error, body.details, body.hint, body.code].filter(Boolean).join(' ') || `فشل التسجيل (${res.status})`);
        return;
      }
      setMessage('تم تسجيل الاستلام');
      await router.replace('/deliveries');
    } catch (error: any) {
      setMessage(error.message || 'تعذر الاتصال بالخادم.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageLayout title="تسجيل استلام">
      <h2 className="text-xl font-semibold mb-4 text-right">تسجيل استلام شحنة</h2>
      {loadingData ? <LoadingState /> : loadFailed ? <ErrorState onRetry={() => { if (stationId) setForm((current: any) => ({ ...current, station_id: stationId })); window.location.reload(); }} /> : <form onSubmit={submit} className="max-w-md space-y-4">
        <FormField label="الخزان">
          <select required value={form.tank_id} onChange={(e) => { update('tank_id', e.target.value); const opt = e.target.selectedOptions[0]; update('fuel_type_id', opt?.dataset?.fuel); }} className="w-full border rounded px-3 py-2">
            <option value="">اختر خزان</option>
            {tanks.map((t) => (<option key={t.tank_id} value={t.tank_id} data-fuel={t.fuel_type_id}>{t.tank_code} — {t.fuel_name}</option>))}
          </select>
        </FormField>

        <FormField label="المورد">
          <select required value={form.supplier_id} onChange={(e) => update('supplier_id', e.target.value)} className="w-full border rounded px-3 py-2">
            <option value="">اختر المورد المحفوظ</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} · {supplier.code}</option>)}
          </select>
          {!suppliers.length && <small className="text-red-600">لا يوجد موردون محفوظون لهذه المحطة. أضف موردًا جديدًا أولًا.</small>}
          <button type="button" className="text-right text-sm font-semibold text-blue-700" onClick={() => setSupplierFormOpen(true)}>+ إضافة مورد جديد</button>
        </FormField>

        <FormField label="تاريخ العملية">
          <input required type="date" value={form.business_date} onChange={(e) => update('business_date', e.target.value)} className="w-full border rounded px-3 py-2" />
        </FormField>

        <FormField label="الكمية (لتر)">
          <input required type="number" step="0.1" value={form.quantity} onChange={(e) => update('quantity', e.target.value)} className="w-full border rounded px-3 py-2" />
        </FormField>

        <FormField label="سعر الوحدة">
          <input required min="0" type="text" inputMode="decimal" placeholder="مثال: 20.62.86" value={form.unit_cost} onChange={(e) => update('unit_cost', e.target.value)} className="w-full border rounded px-3 py-2" />
        </FormField>

        <FormField label="إجمالي التوريد">
          <input readOnly value={formatMoney(multiplyMoney(form.quantity || 0, form.unit_cost || 0))} className="w-full border rounded px-3 py-2 bg-gray-50" />
        </FormField>

        <FormField label="المدفوع">
          <input min="0" type="text" inputMode="decimal" value={form.paid_amount} onChange={(e) => update('paid_amount', e.target.value)} className="w-full border rounded px-3 py-2" />
        </FormField>

        <FormField label="رقم الفاتورة / التوريد">
          <input value={form.reference_no} onChange={(e) => update('reference_no', e.target.value)} className="w-full border rounded px-3 py-2" />
        </FormField>

        <FormField label="ملاحظات">
          <textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} className="w-full border rounded px-3 py-2" />
        </FormField>

        <div className="text-right">
          <button type="submit" disabled={saving} className="bg-primary text-white px-4 py-2 rounded">{saving ? 'جارٍ التسجيل...' : 'تسجيل الاستلام'}</button>
        </div>
        {message && <div className="form-error" role="alert">{message}</div>}
      </form>}
      {supplierFormOpen && <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="ui-card form-card modal-card form-grid" onSubmit={addSupplier}><h3>إضافة مورد جديد</h3><FormField label="اسم المورد"><input required value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} /></FormField><FormField label="كود المورد"><input required value={supplierForm.code} onChange={(e) => setSupplierForm({ ...supplierForm, code: e.target.value })} /></FormField><FormField label="اسم جهة الاتصال"><input value={supplierForm.contact_name} onChange={(e) => setSupplierForm({ ...supplierForm, contact_name: e.target.value })} /></FormField><FormField label="الهاتف"><input value={supplierForm.contact_phone} onChange={(e) => setSupplierForm({ ...supplierForm, contact_phone: e.target.value })} /></FormField><FormField label="ملاحظات"><textarea value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} /></FormField><div className="form-actions"><button className="ui-button" type="submit">حفظ المورد</button><button className="ui-button secondary" type="button" onClick={() => setSupplierFormOpen(false)}>إلغاء</button></div></form></div>}
    </PageLayout>
  );
}

