import React, { useState, useEffect } from 'react';
import PageLayout from '../../src/components/PageLayout';
import FormField from '../../src/components/FormField';
import { useRequireAuth } from '../../src/lib/auth';
import { z } from 'zod';
import { useCurrentStationId } from '../../src/lib/station';

export default function NewAdjustment() {
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [form, setForm] = useState<any>({ station_id: '', tank_id: '', reason: '', quantity: '' });

  useEffect(() => {
    if (stationId) {
      setForm((current: any) => ({ ...current, station_id: stationId }));
    }
  }, [stationId]);
  const [message, setMessage] = useState<string | null>(null);

  function update(k: string, v: any) { setForm((s: any) => ({ ...s, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const schema = z.object({ station_id: z.string().uuid().optional(), tank_id: z.string().min(1), reason: z.string().min(3), quantity: z.number() });
    const parsed = schema.safeParse({ station_id: form.station_id, tank_id: form.tank_id, reason: form.reason, quantity: Number(form.quantity) });
    if (!parsed.success) { setMessage('تحقق من الحقول'); return; }
    const res = await fetch('/api/adjustments/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station_id: form.station_id, tank_id: form.tank_id, reason: form.reason, quantity: Number(form.quantity) }) });
    const b = await res.json();
    if (!res.ok) setMessage(b.error || 'فشل'); else setMessage('تم إنشاء التعديل');
  }

  return (
    <PageLayout title="تعديل مخزون">
      <h2 className="text-xl font-semibold mb-4 text-right">إنشاء تعديل مخزون</h2>
      <form onSubmit={submit} className="max-w-md space-y-4">
        <FormField label="الخزان">
          <input value={form.tank_id} onChange={(e) => update('tank_id', e.target.value)} className="w-full border rounded px-3 py-2" />
        </FormField>
        <FormField label="السبب">
          <input value={form.reason} onChange={(e) => update('reason', e.target.value)} className="w-full border rounded px-3 py-2" />
        </FormField>
        <FormField label="الكمية (موجب/سالب)">
          <input value={form.quantity} onChange={(e) => update('quantity', e.target.value)} className="w-full border rounded px-3 py-2" />
        </FormField>
        <div className="text-right">
          <button className="bg-primary text-white px-4 py-2 rounded">إنشاء تعديل</button>
        </div>
        {message && <div className="text-sm text-muted">{message}</div>}
      </form>
    </PageLayout>
  );
}
