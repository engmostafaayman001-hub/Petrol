import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import PageLayout from '../../src/components/PageLayout';
import FormField from '../../src/components/FormField';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/DataState';
import supabase from '../../src/lib/supabaseClient';
import { useRequireAuth } from '../../src/lib/auth';

type FuelTypeOption = { id: string; name: string; code: string };
type Tank = {
  id: string;
  code: string;
  name: string;
  fuel_type_id: string;
  capacity: number;
  max_operating_level: number;
  min_safe_level: number;
  dead_stock: number;
  status: string;
  is_active: boolean;
  notes?: string | null;
};

const STATION_ID = (process.env.NEXT_PUBLIC_DEMO_STATION_ID || '11111111-1111-4111-8111-111111111111').trim();
const blankForm = {
  code: '',
  name: '',
  fuel_type_id: '',
  capacity: '',
  max_operating_level: '',
  min_safe_level: '',
  dead_stock: '',
  status: 'operational',
  is_active: true,
  notes: '',
};

const STATUS_LABELS: Record<string, string> = {
  operational: 'تشغيلي',
  maintenance: 'صيانة',
  decommissioned: 'متوقف',
};

export default function TankSettings() {
  useRequireAuth();
  const [fuelTypes, setFuelTypes] = useState<FuelTypeOption[]>([]);
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [form, setForm] = useState<typeof blankForm>(blankForm);
  const [editing, setEditing] = useState<Tank | null>(null);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadData = useCallback(async () => {
    setState('loading');
    try {
      const [fuelTypeResult, tankResult] = await Promise.all([
        supabase
          .from('fuel_types')
          .select('id,name,code')
          .eq('station_id', STATION_ID)
          .order('sort_order', { ascending: true }),
        supabase
          .from('tanks')
          .select('id,code,name,fuel_type_id,capacity,max_operating_level,min_safe_level,dead_stock,status,is_active,notes')
          .eq('station_id', STATION_ID)
          .order('code', { ascending: true }),
      ]);

      if (fuelTypeResult.error || tankResult.error) {
        throw fuelTypeResult.error || tankResult.error;
      }

      setFuelTypes(fuelTypeResult.data || []);
      setTanks(tankResult.data || []);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');

    const payload = {
      station_id: STATION_ID,
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      fuel_type_id: form.fuel_type_id,
      capacity: Number(form.capacity) || 0,
      max_operating_level: Number(form.max_operating_level) || 0,
      min_safe_level: Number(form.min_safe_level) || 0,
      dead_stock: Number(form.dead_stock) || 0,
      status: form.status,
      is_active: form.is_active,
      notes: form.notes.trim() || null,
    };

    if (!payload.code || !payload.name || payload.capacity <= 0) {
      setMessage('يجب إدخال الكود والاسم والسعة.');
      return;
    }

    try {
      const query = editing
        ? supabase.from('tanks').update(payload).eq('id', editing.id)
        : supabase.from('tanks').insert(payload);
      const { error } = await query;
      if (error) throw error;
      setMessage(editing ? 'تم تحديث الخزان.' : 'تمت إضافة الخزان.');
      setForm(blankForm);
      setEditing(null);
      await loadData();
    } catch (err: any) {
      setMessage(err?.message || 'فشل حفظ الخزان.');
    }
  }

  async function removeTank(tank: Tank) {
    if (!window.confirm(`هل تريد تعطيل الخزان ${tank.code}؟`)) return;
    setMessage('');
    const { error } = await supabase
      .from('tanks')
      .update({ is_active: false, status: 'decommissioned' })
      .eq('id', tank.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage('تم تعطيل الخزان.');
    await loadData();
  }

  function editTank(tank: Tank) {
    setEditing(tank);
    setForm({
      code: tank.code,
      name: tank.name,
      fuel_type_id: tank.fuel_type_id,
      capacity: String(tank.capacity ?? ''),
      max_operating_level: String(tank.max_operating_level ?? ''),
      min_safe_level: String(tank.min_safe_level ?? ''),
      dead_stock: String(tank.dead_stock ?? ''),
      status: tank.status,
      is_active: tank.is_active,
      notes: tank.notes || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setEditing(null);
    setForm(blankForm);
    setMessage('');
  }

  return (
    <PageLayout title="إعدادات الخزانات">
      <div className="page-heading">
        <div>
          <h2>إعدادات الخزانات</h2>
          <p>إدارة الخزانات وتعيين أنواع الوقود المرتبطة بها.</p>
        </div>
        <Link className="ui-button secondary" href="/settings">
          العودة للإعدادات
        </Link>
      </div>

      <form onSubmit={submit} className="ui-card form-card form-grid">
        <h3 className="text-xl font-semibold">{editing ? 'تعديل الخزان' : 'إضافة خزان جديد'}</h3>

        <FormField label="الكود">
          <input
            value={form.code}
            onChange={(e) => setForm((current) => ({ ...current, code: e.target.value }))}
            className="w-full border rounded px-3 py-2"
            placeholder="مثال: GAS95"
          />
        </FormField>

        <FormField label="الاسم">
          <input
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            className="w-full border rounded px-3 py-2"
            placeholder="مثال: خزان 95"
          />
        </FormField>

        <FormField label="نوع الوقود">
          <select
            value={form.fuel_type_id}
            onChange={(e) => setForm((current) => ({ ...current, fuel_type_id: e.target.value }))}
            className="w-full border rounded px-3 py-2"
          >
            <option value="">اختر نوع الوقود</option>
            {fuelTypes.map((fuel) => (
              <option key={fuel.id} value={fuel.id}>
                {fuel.code} - {fuel.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="السعة (لتر)">
          <input
            type="number"
            step="0.1"
            value={form.capacity}
            onChange={(e) => setForm((current) => ({ ...current, capacity: e.target.value }))}
            className="w-full border rounded px-3 py-2"
          />
        </FormField>

        <FormField label="أقصى مستوى تشغيل (لتر)">
          <input
            type="number"
            step="0.1"
            value={form.max_operating_level}
            onChange={(e) => setForm((current) => ({ ...current, max_operating_level: e.target.value }))}
            className="w-full border rounded px-3 py-2"
          />
        </FormField>

        <FormField label="الحد الأدنى الآمن (لتر)">
          <input
            type="number"
            step="0.1"
            value={form.min_safe_level}
            onChange={(e) => setForm((current) => ({ ...current, min_safe_level: e.target.value }))}
            className="w-full border rounded px-3 py-2"
          />
        </FormField>

        <FormField label="المخزون الميت (لتر)">
          <input
            type="number"
            step="0.1"
            value={form.dead_stock}
            onChange={(e) => setForm((current) => ({ ...current, dead_stock: e.target.value }))}
            className="w-full border rounded px-3 py-2"
          />
        </FormField>

        <FormField label="الحالة">
          <select
            value={form.status}
            onChange={(e) => setForm((current) => ({ ...current, status: e.target.value }))}
            className="w-full border rounded px-3 py-2"
          >
            <option value="operational">تشغيلي</option>
            <option value="maintenance">صيانة</option>
            <option value="decommissioned">متوقف</option>
          </select>
        </FormField>

        <FormField label="نشط">
          <select
            value={String(form.is_active)}
            onChange={(e) => setForm((current) => ({ ...current, is_active: e.target.value === 'true' }))}
            className="w-full border rounded px-3 py-2"
          >
            <option value="true">نعم</option>
            <option value="false">لا</option>
          </select>
        </FormField>

        <FormField label="ملاحظات">
          <textarea
            value={form.notes}
            onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
            className="w-full border rounded px-3 py-2"
            rows={3}
          />
        </FormField>

        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex gap-3 flex-wrap">
            <button className="ui-button" type="submit">
              {editing ? 'حفظ التعديلات' : 'إضافة خزان'}
            </button>
            {editing && (
              <button type="button" className="ui-button secondary" onClick={resetForm}>
                إلغاء
              </button>
            )}
          </div>
          {message && <p className="text-sm text-[var(--text-muted)]">{message}</p>}
        </div>
      </form>

      <section className="ui-card mt-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-lg font-semibold">قائمة الخزانات</h3>
            <button className="ui-button secondary" type="button" onClick={loadData}>
              تحديث
            </button>
          </div>

          {state === 'loading' ? (
            <LoadingState />
          ) : state === 'error' ? (
            <ErrorState onRetry={loadData} />
          ) : tanks.length === 0 ? (
            <EmptyState title="لا توجد خزانات" description="أضف خزاناً من النموذج أعلاه." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-right border-separate border-spacing-y-3">
                <thead>
                  <tr className="text-sm text-[var(--text-muted)]">
                    <th className="px-4 py-3">الكود</th>
                    <th className="px-4 py-3">الاسم</th>
                    <th className="px-4 py-3">الوقود</th>
                    <th className="px-4 py-3">الحالة</th>
                    <th className="px-4 py-3">نشط</th>
                    <th className="px-4 py-3">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {tanks.map((tank) => {
                    const fuelLabel = fuelTypes.find((fuel) => fuel.id === tank.fuel_type_id)?.name || 'غير معروف';
                    return (
                      <tr key={tank.id} className="border border-[var(--border)] bg-[var(--surface)]">
                        <td className="px-4 py-3 align-top">{tank.code}</td>
                        <td className="px-4 py-3">{tank.name}</td>
                        <td className="px-4 py-3">{fuelLabel}</td>
                        <td className="px-4 py-3">{STATUS_LABELS[tank.status] || tank.status}</td>
                        <td className="px-4 py-3">{tank.is_active ? 'نعم' : 'لا'}</td>
                        <td className="px-4 py-3 space-x-2 whitespace-nowrap">
                          <button className="ui-button secondary" type="button" onClick={() => editTank(tank)}>
                            تعديل
                          </button>
                          <button className="ui-button danger" type="button" onClick={() => removeTank(tank)}>
                            تعطيل
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </PageLayout>
  );
}

