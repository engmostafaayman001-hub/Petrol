import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import PageLayout from '../../src/components/PageLayout';
import { useRequireAuth } from '../../src/lib/auth';
import FormField from '../../src/components/FormField';
import { z } from 'zod';

const DEMO_STATION = (process.env.NEXT_PUBLIC_DEMO_STATION_ID || '11111111-1111-4111-8111-111111111111').trim();

export default function NewSale() {
  useRequireAuth();
  const router = useRouter();
  const [tanks, setTanks] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ station_id: DEMO_STATION, tank_id: '', business_date: '', shift_id: '', quantity: '' });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/tanks?stationId=${DEMO_STATION}`)
      .then((r) => r.json())
      .then((d) => setTanks(d.tanks || []))
      .catch(() => {});
  }, []);

  function update(k: string, v: any) {
    setForm((s: any) => ({ ...s, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const schema = z.object({ station_id: z.string().uuid(), tank_id: z.string().uuid(), fuel_type_id: z.string().uuid().optional(), business_date: z.string().min(1), shift_id: z.string().uuid().optional(), quantity: z.number().positive() });
    const parsed = schema.safeParse({ station_id: form.station_id, tank_id: form.tank_id, fuel_type_id: form.fuel_type_id || undefined, business_date: form.business_date, shift_id: form.shift_id || undefined, quantity: Number(form.quantity) });
    if (!parsed.success) {
      setMessage('تحقق من الحقول');
      return;
    }

    const payload: any = {
      station_id: form.station_id,
      tank_id: form.tank_id,
      business_date: form.business_date,
      quantity: Number(form.quantity),
    };
    if (form.fuel_type_id) payload.fuel_type_id = form.fuel_type_id;
    if (form.shift_id) payload.shift_id = form.shift_id;

    const res = await fetch('/api/sales/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) {
      setMessage(body.error || 'فشل التسجيل');
      return;
    }

    router.push('/sales');
  }

  return (
    <PageLayout title="تسجيل بيع">
      <h2 className="text-xl font-semibold mb-4 text-right">تسجيل بيع</h2>
      <form onSubmit={submit} className="max-w-md space-y-4">
        <FormField label="الخزان">
          <select required value={form.tank_id} onChange={(e) => { update('tank_id', e.target.value); const opt = e.target.selectedOptions[0]; update('fuel_type_id', opt?.dataset?.fuel); }} className="w-full border rounded px-3 py-2">
            <option value="">اختر خزان</option>
            {tanks.map((t) => (
              <option key={t.tank_id} value={t.tank_id} data-fuel={t.fuel_type_id}>{t.tank_code} — {t.fuel_name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="تاريخ العملية">
          <input required type="date" value={form.business_date} onChange={(e) => update('business_date', e.target.value)} className="w-full border rounded px-3 py-2" />
        </FormField>

        <FormField label="الكمية (لتر)">
          <input required type="number" step="0.1" value={form.quantity} onChange={(e) => update('quantity', e.target.value)} className="w-full border rounded px-3 py-2" />
        </FormField>

        <div className="text-right">
          <button className="bg-primary text-white px-4 py-2 rounded">تسجيل البيع</button>
        </div>
        {message && <div className="text-sm text-muted">{message}</div>}
      </form>
    </PageLayout>
  );
}
