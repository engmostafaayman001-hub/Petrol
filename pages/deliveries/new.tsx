import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import PageLayout from '../../src/components/PageLayout';
import { useRequireAuth } from '../../src/lib/auth';
import FormField from '../../src/components/FormField';
import { useCurrentStationId } from '../../src/lib/station';

export default function NewDelivery() {
  const { user } = useRequireAuth();
  const router = useRouter();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [tanks, setTanks] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ station_id: '', tank_id: '', business_date: '', supplier_id: '', quantity: '' });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!stationId) {
      setTanks([]);
      return;
    }

    setForm((current: any) => ({ ...current, station_id: stationId }));
    fetch(`/api/tanks?stationId=${encodeURIComponent(stationId)}`)
      .then((r) => r.json())
      .then((d) => setTanks(d.tanks || []))
      .catch(() => setTanks([]));
  }, [stationId]);

  function update(k: string, v: any) { setForm((s: any) => ({ ...s, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const stationIdValue = (form.station_id || stationId || '').trim();
    const quantity = Number(form.quantity);

    if (!stationIdValue || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(stationIdValue)) {
      setMessage('معرف المحطة غير صالح');
      return;
    }

    if (!form.tank_id || !form.business_date || !Number.isFinite(quantity) || quantity <= 0) {
      setMessage('تحقق من الحقول');
      return;
    }

    const payload = { station_id: stationIdValue, tank_id: form.tank_id, fuel_type_id: form.fuel_type_id || undefined, business_date: form.business_date, supplier_id: form.supplier_id || undefined, quantity };
    const res = await fetch('/api/deliveries/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json();
    if (!res.ok) {
      setMessage(body.error || 'فشل التسجيل');
      return;
    }

    setMessage('تم تسجيل الاستلام');
    router.replace('/deliveries');
  }

  return (
    <PageLayout title="تسجيل استلام">
      <h2 className="text-xl font-semibold mb-4 text-right">تسجيل استلام شحنة</h2>
      <form onSubmit={submit} className="max-w-md space-y-4">
        <FormField label="الخزان">
          <select required value={form.tank_id} onChange={(e) => { update('tank_id', e.target.value); const opt = e.target.selectedOptions[0]; update('fuel_type_id', opt?.dataset?.fuel); }} className="w-full border rounded px-3 py-2">
            <option value="">اختر خزان</option>
            {tanks.map((t) => (<option key={t.tank_id} value={t.tank_id} data-fuel={t.fuel_type_id}>{t.tank_code} — {t.fuel_name}</option>))}
          </select>
        </FormField>

        <FormField label="تاريخ العملية">
          <input required type="date" value={form.business_date} onChange={(e) => update('business_date', e.target.value)} className="w-full border rounded px-3 py-2" />
        </FormField>

        <FormField label="الكمية (لتر)">
          <input required type="number" step="0.1" value={form.quantity} onChange={(e) => update('quantity', e.target.value)} className="w-full border rounded px-3 py-2" />
        </FormField>

        <div className="text-right">
          <button className="bg-primary text-white px-4 py-2 rounded">تسجيل الاستلام</button>
        </div>
        {message && <div className="text-sm text-muted">{message}</div>}
      </form>
    </PageLayout>
  );
}

