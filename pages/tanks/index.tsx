import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import PageLayout from '../../src/components/PageLayout';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/DataState';
import { validateTankTransferInput } from '../../src/core/tankTransfer';
import { useRequireAuth } from '../../src/lib/auth';
import { useCurrentStationId } from '../../src/lib/station';
import supabase from '../../src/lib/supabaseClient';

type Tank = { tank_id: string; tank_code?: string; tank_name?: string; fuel_name?: string; fuel_type_id?: string; system_quantity?: number; available_quantity?: number; capacity?: number; fill_pct?: number; status?: string; below_minimum?: boolean; ullage?: number };
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const format = (value: unknown) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(number(value));

export default function TanksPage() {
  const { user } = useRequireAuth(); const stationId = useCurrentStationId(user?.id ?? null);
  const [tanks, setTanks] = useState<Tank[]>([]); const [state, setState] = useState<'loading'|'ready'|'error'>('loading'); const [filter, setFilter] = useState('الكل');
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({ sourceTankId: '', destinationTankId: '', quantity: '', note: '' });
  const [transferMessage, setTransferMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(async () => { if (!stationId) return; setState('loading'); try { const { data: auth } = await supabase.auth.getSession(); const headers: Record<string, string> = auth.session?.access_token ? { Authorization: `Bearer ${auth.session.access_token}` } : {}; const response = await fetch(`/api/tanks?stationId=${encodeURIComponent(stationId)}`, { headers }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setTanks(data.tanks || []); setState('ready'); } catch { setState('error'); } }, [stationId]);
  useEffect(() => { if (stationId) load(); }, [stationId, load]);

  const summary = useMemo(() => tanks.reduce((total, tank) => ({ stock: total.stock + number(tank.system_quantity), available: total.available + number(tank.available_quantity), capacity: total.capacity + number(tank.capacity), low: total.low + (tank.below_minimum ? 1 : 0) }), { stock: 0, available: 0, capacity: 0, low: 0 }), [tanks]);
  const fuels = useMemo(() => Object.values(tanks.reduce<Record<string, { name: string; stock: number; capacity: number; tanks: number }>>((result, tank) => { const name = tank.fuel_name || 'غير محدد'; const item = result[name] || { name, stock: 0, capacity: 0, tanks: 0 }; item.stock += number(tank.system_quantity); item.capacity += number(tank.capacity); item.tanks += 1; result[name] = item; return result; }, {})), [tanks]);
  const visibleTanks = filter === 'الكل' ? tanks : tanks.filter((tank) => (tank.fuel_name || 'غير محدد') === filter);
  const sourceTank = tanks.find((tank) => tank.tank_id === transferForm.sourceTankId) || null;
  const destinationTank = tanks.find((tank) => tank.tank_id === transferForm.destinationTankId) || null;
  const destinationOptions = useMemo(() => {
    if (!sourceTank) return [];

    return tanks.filter((tank) => tank.tank_id !== sourceTank.tank_id);
  }, [sourceTank, tanks]);
  const hasDifferentFuelType = !!sourceTank && !!destinationTank && !!sourceTank.fuel_type_id && !!destinationTank.fuel_type_id && sourceTank.fuel_type_id !== destinationTank.fuel_type_id;

  const fill = summary.capacity ? Math.round((summary.stock / summary.capacity) * 100) : 0;

  async function submitTransfer(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;

    setTransferMessage('');
    if (!stationId) {
      setTransferMessage('لا توجد محطة مرتبطة بهذا الحساب.');
      return;
    }

    const source = tanks.find((tank) => tank.tank_id === transferForm.sourceTankId) ?? null;
    const destination = tanks.find((tank) => tank.tank_id === transferForm.destinationTankId) ?? null;
    const qty = Number(transferForm.quantity);
    const validation = validateTankTransferInput({
      sourceTankId: source?.tank_id ?? '',
      destinationTankId: destination?.tank_id ?? '',
      quantity: qty,
      sourceActive: !!source && !!source.tank_id,
      destinationActive: !!destination && !!destination.tank_id,
      sourceBalance: Number(source?.system_quantity ?? 0),
      destinationBalance: Number(destination?.system_quantity ?? 0),
    });

    if (!validation.ok) {
      setTransferMessage(validation.error);
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(auth.session?.access_token ? { Authorization: `Bearer ${auth.session.access_token}` } : {}) };
      const requestToken = `tank-transfer:${stationId}:${source?.tank_id}:${destination?.tank_id}:${qty}:${Date.now()}`;
      const response = await fetch('/api/tanks/transfer', {
        method: 'POST',
        headers,
        body: JSON.stringify({ station_id: stationId, source_tank_id: source?.tank_id, destination_tank_id: destination?.tank_id, quantity: qty, note: transferForm.note.trim() || null, business_date: new Date().toISOString().slice(0, 10), request_token: requestToken }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'تعذر تنفيذ النقل.');
      setTransferMessage(`تم نقل ${format(qty)} لتر بنجاح من ${source?.tank_name || source?.tank_code || 'الخزان'} إلى ${destination?.tank_name || destination?.tank_code || 'الخزان'}.`);
      setTransferForm({ sourceTankId: '', destinationTankId: '', quantity: '', note: '' });
      setTransferOpen(false);
      await load();
    } catch (error: any) {
      setTransferMessage(error.message || 'تعذر تنفيذ النقل.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return <PageLayout title="الخزانات والمخزون"><main className="inventory-page">
    <header className="inventory-hero"><div><span className="inventory-eyebrow">مراقبة المخزون</span><h2>الخزانات والمخزون</h2><p>تابع الرصيد الفعلي والسعة المتاحة لكل نوع وقود في مكان واحد.</p></div><div className="inventory-actions"><button className="ui-button secondary" onClick={load}>تحديث البيانات</button><button className="ui-button" onClick={() => setTransferOpen(true)}>نقل بين الخزانات</button><Link href="/settings/tanks" className="ui-button">إدارة الخزانات</Link></div></header>
    <section className="inventory-overview"><article className="inventory-main-stat"><div><small>إجمالي الرصيد الحالي</small><strong>{format(summary.stock)} <em>لتر</em></strong><p>{fill}% من إجمالي السعة</p></div><div className="inventory-gauge" style={{ '--fill': `${fill}%` } as React.CSSProperties}><span>{fill}%</span></div></article><article><small>المخزون المتاح للبيع</small><strong>{format(summary.available)} <em>لتر</em></strong><p>بعد استبعاد المخزون الميت</p></article><article><small>السعة الكلية</small><strong>{format(summary.capacity)} <em>لتر</em></strong><p>{tanks.length} خزان مسجل</p></article><article className={summary.low ? 'inventory-alert' : ''}><small>تنبيهات المستوى</small><strong>{summary.low}</strong><p>{summary.low ? 'خزان يحتاج متابعة' : 'جميع المستويات آمنة'}</p></article></section>
    {state === 'loading' ? <LoadingState /> : state === 'error' ? <ErrorState onRetry={load} /> : tanks.length === 0 ? <EmptyState title="لا توجد خزانات مسجلة" description="أضف خزاناً من إعدادات الخزانات ليظهر هنا تلقائياً." /> : <>
      <section className="inventory-fuels"><div className="inventory-section-title"><div><h3>ملخص حسب نوع الوقود</h3><p>إجمالي الرصيد والسعة لكل نوع.</p></div></div><div className="fuel-summary-grid">{fuels.map((fuel, index) => { const percentage = fuel.capacity ? Math.min(100, Math.round(fuel.stock / fuel.capacity * 100)) : 0; return <button key={fuel.name} className={`fuel-summary ${filter === fuel.name ? 'selected' : ''}`} onClick={() => setFilter(filter === fuel.name ? 'الكل' : fuel.name)}><i className={`fuel-accent fuel-accent-${index % 4}`} /><span><b>{fuel.name}</b><small>{fuel.tanks} خزان</small></span><strong>{format(fuel.stock)} <em>لتر</em></strong><div className="fuel-mini-bar"><i style={{ width: `${percentage}%` }} /></div><small>{percentage}% من السعة</small></button>; })}</div></section>
      <section className="inventory-tanks"><div className="inventory-section-title"><div><h3>{filter === 'الكل' ? 'حالة جميع الخزانات' : `خزانات ${filter}`}</h3><p>{visibleTanks.length} خزان ظاهر</p></div>{filter !== 'الكل' && <button className="ui-button secondary" onClick={() => setFilter('الكل')}>عرض الكل</button>}</div><div className="tank-monitor-grid">{visibleTanks.map((tank) => { const percentage = Math.max(0, Math.min(100, number(tank.fill_pct))); const tone = tank.below_minimum ? 'critical' : percentage <= 30 ? 'warning' : 'healthy'; return <article className={`tank-monitor ${tone}`} key={tank.tank_id}><header><div><span className="tank-code">{tank.tank_code || 'خزان'}</span><h4>{tank.tank_name || tank.fuel_name || 'خزان وقود'}</h4></div><span className="tank-status">{tank.below_minimum ? 'منخفض' : percentage <= 30 ? 'تنبيه' : 'طبيعي'}</span></header><div className="tank-quantity"><strong>{format(tank.system_quantity)}</strong><span>لتر</span></div><div className="tank-level"><div><i style={{ width: `${percentage}%` }} /></div><span>{Math.round(percentage)}%</span></div><footer><span>المتاح <b>{format(tank.available_quantity)} لتر</b></span><span>السعة <b>{format(tank.capacity)} لتر</b></span></footer></article>; })}</div></section>
    </>}
    {transferOpen && <div className="modal-backdrop" onMouseDown={() => setTransferOpen(false)}><form onMouseDown={(event) => event.stopPropagation()} onSubmit={submitTransfer} className="ui-card form-card modal-card" style={{ maxWidth: 560 }}>
      <h3 className="text-xl font-semibold mb-4">نقل بين الخزانات</h3>
      <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 mb-4">
      </div>
      <div className="space-y-4">
        <label className="block"><span className="mb-1 block text-sm font-medium">من خزان</span><select value={transferForm.sourceTankId} onChange={(event) => setTransferForm((current) => ({ ...current, sourceTankId: event.target.value, destinationTankId: '' }))} className="w-full border rounded px-3 py-2"><option value="">اختر الخزان المصدر</option>{tanks.map((tank) => <option key={tank.tank_id} value={tank.tank_id}>{tank.tank_name || tank.tank_code || 'خزان'} · {tank.fuel_name || 'وقود'}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-sm font-medium">إلى خزان</span><select value={transferForm.destinationTankId} onChange={(event) => setTransferForm((current) => ({ ...current, destinationTankId: event.target.value }))} className="w-full border rounded px-3 py-2" disabled={!sourceTank}><option value="">{sourceTank ? 'اختر الخزان المستهدف' : 'اختر الخزان المصدر أولاً'}</option>{destinationOptions.map((tank) => <option key={tank.tank_id} value={tank.tank_id}>{tank.tank_name || tank.tank_code || 'خزان'} · {tank.fuel_name || 'وقود'}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-sm font-medium">الكمية (لتر)</span><input type="number" min="0.001" step="0.001" value={transferForm.quantity} onChange={(event) => setTransferForm((current) => ({ ...current, quantity: event.target.value }))} className="w-full border rounded px-3 py-2" placeholder="مثل: 2000" /></label>
        <label className="block"><span className="mb-1 block text-sm font-medium">ملاحظة (اختياري)</span><textarea value={transferForm.note} onChange={(event) => setTransferForm((current) => ({ ...current, note: event.target.value }))} className="w-full border rounded px-3 py-2" rows={3} placeholder="مثال: نقل داخلي بين الخزانات" /></label>
        {sourceTank && destinationTank && hasDifferentFuelType && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">تنبيه:</p><p>أنت تقوم بنقل كمية من: <strong>{sourceTank.fuel_name || 'وقود'}</strong></p><p>إلى: <strong>{destinationTank.fuel_name || 'وقود'}</strong></p><p>تأكد أن عملية النقل صحيحة قبل المتابعة.</p></div>}
        {sourceTank && transferForm.destinationTankId && <div className="rounded border bg-slate-50 p-3 text-sm text-slate-700"><p><strong>سيتم نقل {format(Number(transferForm.quantity || 0))} لتر {sourceTank.fuel_name || 'وقود'}</strong></p><p>من: {sourceTank.tank_name || sourceTank.tank_code || 'الخزان'}</p><p>إلى: {destinationTank?.tank_name || destinationTank?.tank_code || 'الخزان'}</p></div>}
        {transferMessage && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{transferMessage}</div>}
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" className="ui-button secondary" onClick={() => { setTransferOpen(false); setTransferMessage(''); setIsSubmitting(false); }}>إلغاء</button>
        <button type="submit" className="ui-button" disabled={isSubmitting}>{isSubmitting ? 'جاري التنفيذ...' : 'تأكيد النقل'}</button>
      </div>
    </form></div>}
  </main></PageLayout>;
}
