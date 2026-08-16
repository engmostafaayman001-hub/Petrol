import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import PageLayout from '../../src/components/PageLayout';
import FormField from '../../src/components/FormField';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/DataState';
import supabase from '../../src/lib/supabaseClient';
import { useRequireAuth } from '../../src/lib/auth';
import { useCurrentStationId } from '../../src/lib/station';

type FuelType = {
  id: string;
  code: string;
  name: string;
  selling_price: number;
  purchase_price: number;
  color_hex: string;
  sort_order: number;
  is_active: boolean;
  notes?: string | null;
};

const blankForm = {
  code: '',
  name: '',
  selling_price: '',
  purchase_price: '',
  color_hex: '#5B9CFF',
  sort_order: '100',
  is_active: true,
  notes: '',
};

export default function FuelSettings() {
  const { user } = useRequireAuth();
  const stationId = useCurrentStationId(user?.id ?? null);
  const [fuelTypes, setFuelTypes] = useState<FuelType[]>([]);
  const [form, setForm] = useState<typeof blankForm>(blankForm);
  const [editing, setEditing] = useState<FuelType | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadFuelTypes = useCallback(async () => {
    if (!stationId) {
      setFuelTypes([]);
      setState('ready');
      return;
    }

    setState('loading');
    try {
      const { data, error } = await supabase
        .from('fuel_types')
        .select('id,code,name,selling_price,purchase_price,color_hex,sort_order,is_active,notes')
        .eq('station_id', stationId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setFuelTypes(data || []);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [stationId]);

  useEffect(() => {
    loadFuelTypes();
  }, [loadFuelTypes]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');

    if (!stationId) {
      setMessage('لا توجد محطة مرتبطة بهذا الحساب.');
      return;
    }

    const payload = {
      station_id: stationId,
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      selling_price: Number(form.selling_price) || 0,
      purchase_price: Number(form.purchase_price) || 0,
      color_hex: form.color_hex.trim() || '#5B9CFF',
      sort_order: Number(form.sort_order) || 100,
      is_active: form.is_active,
      notes: form.notes.trim() || null,
    };

    if (!payload.code || !payload.name) {
      setMessage('يجب إدخال الكود والاسم.');
      return;
    }
    if (payload.selling_price < 0 || payload.purchase_price < 0) {
      setMessage('لا يمكن أن يكون سعر البيع أو الشراء سالباً.');
      return;
    }

    try {
      const query = editing
        ? supabase.from('fuel_types').update(payload).eq('id', editing.id)
        : supabase.from('fuel_types').insert(payload);
      const { error } = await query;
      if (error) throw error;
      setMessage(editing ? 'تم تحديث نوع الوقود.' : 'تمت إضافة نوع الوقود.');
      setForm(blankForm);
      setEditing(null);
      setEditorOpen(false);
      await loadFuelTypes();
    } catch (err: any) {
      setMessage(err?.message || 'تعذر حفظ نوع الوقود. تأكد من صلاحية المدير وعدم تكرار الكود.');
    }
  }

  async function removeFuelType(fuel: FuelType) {
    if (!window.confirm(`هل تريد حذف نوع الوقود ${fuel.name} نهائياً؟`)) return;
    setMessage('');
    const { count } = await supabase.from('tanks').select('id', { count: 'exact', head: true }).eq('fuel_type_id', fuel.id);
    if (count && count > 0) {
      setMessage('لا يمكن حذف هذا النوع لأنه مرتبط بخزان. عطّل الخزانات أو غيّر نوع وقودها أولاً.');
      return;
    }
    const { error } = await supabase.from('fuel_types').delete().eq('id', fuel.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage('تم حذف نوع الوقود.');
    await loadFuelTypes();
  }

  function editFuelType(fuel: FuelType) {
    setEditing(fuel);
    setForm({
      code: fuel.code,
      name: fuel.name,
      selling_price: String(fuel.selling_price ?? ''),
      purchase_price: String(fuel.purchase_price ?? ''),
      color_hex: fuel.color_hex || '#5B9CFF',
      sort_order: String(fuel.sort_order ?? 100),
      is_active: fuel.is_active,
      notes: fuel.notes || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setEditorOpen(true);
  }

  function resetForm() {
    setEditing(null);
    setForm(blankForm);
    setMessage('');
  }

  return (
    <PageLayout title="إعدادات أنواع الوقود">
      <div className="page-heading">
        <div>
          <h2>إعدادات أنواع الوقود</h2>
          <p>إدارة الأنواع والأسعار والألوان المرتبطة بالوقود.</p>
        </div>
        <Link className="ui-button secondary" href="/settings">
          العودة للإعدادات
        </Link>
        <button type="button" className="ui-button" onClick={() => { resetForm(); setEditorOpen(true); }}>إضافة نوع وقود</button>
      </div>

      {editorOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={() => setEditorOpen(false)}><form onMouseDown={(event) => event.stopPropagation()} onSubmit={submit} className="ui-card form-card form-grid modal-card">
        <h3 className="text-xl font-semibold">{editing ? 'تعديل نوع الوقود' : 'إضافة نوع وقود جديد'}</h3>

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
            placeholder="مثال: 95"
          />
        </FormField>

        <FormField label="سعر البيع (لتر)">
          <input
            type="number"
            step="0.01"
            value={form.selling_price}
            onChange={(e) => setForm((current) => ({ ...current, selling_price: e.target.value }))}
            className="w-full border rounded px-3 py-2"
          />
        </FormField>

        <FormField label="سعر الشراء (لتر)">
          <input
            type="number"
            step="0.01"
            value={form.purchase_price}
            onChange={(e) => setForm((current) => ({ ...current, purchase_price: e.target.value }))}
            className="w-full border rounded px-3 py-2"
          />
        </FormField>

        <FormField label="لون العرض">
          <input
            type="color"
            value={form.color_hex}
            onChange={(e) => setForm((current) => ({ ...current, color_hex: e.target.value }))}
            className="w-full h-10 rounded border p-1"
          />
        </FormField>

        <FormField label="ترتيب العرض">
          <input
            type="number"
            step="1"
            value={form.sort_order}
            onChange={(e) => setForm((current) => ({ ...current, sort_order: e.target.value }))}
            className="w-full border rounded px-3 py-2"
          />
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
              {editing ? 'حفظ التعديلات' : 'إضافة نوع الوقود'}
            </button>
            <button type="button" className="ui-button secondary" onClick={() => { resetForm(); setEditorOpen(false); }}>
                إلغاء
            </button>
          </div>
          {message && <p className="text-sm text-[var(--text-muted)]">{message}</p>}
        </div>
      </form></div>}

      <section className="ui-card mt-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-lg font-semibold">قائمة أنواع الوقود</h3>
            <button className="ui-button secondary" type="button" onClick={loadFuelTypes}>
              تحديث
            </button>
          </div>

          {state === 'loading' ? (
            <LoadingState />
          ) : state === 'error' ? (
            <ErrorState onRetry={loadFuelTypes} />
          ) : fuelTypes.length === 0 ? (
            <EmptyState title="لا توجد أنواع وقود" description="أضف نوع وقود جديدًا من النموذج أعلاه." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-right border-separate border-spacing-y-3">
                <thead>
                  <tr className="text-sm text-[var(--text-muted)]">
                    <th className="px-4 py-3">الكود</th>
                    <th className="px-4 py-3">الاسم</th>
                    <th className="px-4 py-3">سعر البيع</th>
                    <th className="px-4 py-3">سعر الشراء</th>
                    <th className="px-4 py-3">نشط</th>
                    <th className="px-4 py-3">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {fuelTypes.map((fuel) => (
                    <tr key={fuel.id} className="border border-[var(--border)] bg-[var(--surface)]">
                      <td className="px-4 py-3 align-top">{fuel.code}</td>
                      <td className="px-4 py-3">{fuel.name}</td>
                      <td className="px-4 py-3">{fuel.selling_price?.toLocaleString('ar-EG')}</td>
                      <td className="px-4 py-3">{fuel.purchase_price?.toLocaleString('ar-EG')}</td>
                      <td className="px-4 py-3">{fuel.is_active ? 'نعم' : 'لا'}</td>
                      <td className="px-4 py-3 space-x-2 whitespace-nowrap">
                        <button className="ui-button secondary" type="button" onClick={() => editFuelType(fuel)}>
                          تعديل
                        </button>
                        <button className="ui-button danger" type="button" onClick={() => removeFuelType(fuel)}>
                          حذف
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </PageLayout>
  );
}
