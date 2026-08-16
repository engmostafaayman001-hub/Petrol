import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Header from '../src/components/Header';
import { useRequireAuth } from '../src/lib/auth';
import supabase from '../src/lib/supabaseClient';
import { ErrorState, LoadingState } from '../src/components/DataState';
import { sumTankStock } from '../src/core/inventory/engine';

type Snapshot = {
  stock?: { total_system?: number; total_available?: number; total_capacity?: number };
  today?: {
    sold?: number;
    delivered?: number;
    delivery_count?: number;
    sale_count?: number;
    total_collected?: number;
    total_cost?: number;
    total_profit?: number;
  };
  totals?: { total_collected?: number; total_cost?: number; total_profit?: number };
  reconciliation?: { total_variance?: number; open?: number };
  attention?: { critical_alerts?: number };
  trend?: Array<{ business_date?: string; closing_stock?: number; sold?: number; delivered?: number; variance?: number }>;
};
type Tank = { tank_id: string; tank_code?: string; fuel_name?: string; fuel_type?: string; system_quantity?: number; current_qty?: number; current_stock?: number; capacity?: number; capacity_liters?: number; fill_pct?: number; percentage?: number };
type IconName = 'stock' | 'sales' | 'operations' | 'report' | 'plus' | 'adjust' | 'transfer';
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const format = (value: unknown) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(number(value));

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = { stock: <><path d="M6 3h12v18H6z"/><path d="M9 7h6m-6 4h6m-6 4h4"/></>, sales: <><path d="M5 20V6h14v14H5Z"/><path d="m8 15 3-3 2 2 3-4"/></>, operations: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/></>, report: <><path d="M4 20V4m0 16h17"/><path d="M8 16v-4m4 4V8m4 8v-6"/></>, plus: <path d="M12 5v14M5 12h14"/>, adjust: <><path d="M5 7h14M5 17h14"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></>, transfer: <path d="M6 7h11m-3-3 3 3-3 3M18 17H7m3 3-3-3 3-3"/> };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Graph({ points }: { points: Array<{ label: string; value: number }> }) {
  if (!points.length) {
    return <div className="dash-chart"><svg viewBox="0 0 650 230" preserveAspectRatio="none"><path d="M0 160H650" stroke="#e7edf5"/><path d="M0 160C150 120,220 75,330 98S520 45,650 95" fill="none" stroke="#1769f5" strokeWidth="3"/></svg><div><span>لا توجد بيانات</span></div></div>;
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;

  const coords = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * 620;
    const y = 210 - ((value - min) / range) * 160;
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  const area = `${coords} L 620 210 L 0 210 Z`;

  return <div className="dash-chart"><svg viewBox="0 0 650 230" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#1769f5" stopOpacity=".2"/><stop offset="1" stopColor="#1769f5" stopOpacity="0"/></linearGradient></defs>{[35,85,135,185].map(y => <path key={y} d={`M0 ${y}H650`} stroke="#e7edf5"/>)}<path d={area} fill="url(#fill)"/><path d={coords} fill="none" stroke="#1769f5" strokeWidth="3"/></svg><div>{points.map((point) => <span key={point.label}>{point.label}</span>)}</div></div>;
}

export default function Dashboard() {
  const { user, isLoading } = useRequireAuth();
  const [stationId, setStationId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!user?.id) {
      setStationId(null);
      return;
    }

    let mounted = true;
    supabase
      .from('profiles')
      .select('station_id')
      .eq('id', user.id)
      .maybeSingle()
      .then((result: { data: { station_id?: string } | null; error: { message?: string } | null }) => {
        if (!mounted) return;
        const profile = result.data;
        const profileError = result.error;
        if (profileError || !profile?.station_id) {
          setStationId(null);
          return;
        }
        setStationId(profile.station_id);
      });

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const load = useCallback(async () => {
    if (!stationId) {
      setSnapshot(null);
      setTanks([]);
      setState('ready');
      return;
    }

    setState('loading');
    try {
      const [overview, inventory] = await Promise.all([
        fetch(`/api/station/snapshot?stationId=${encodeURIComponent(stationId)}`),
        fetch(`/api/tanks?stationId=${encodeURIComponent(stationId)}`),
      ]);

      const [a, b] = await Promise.all([overview.json().catch(() => ({})), inventory.json().catch(() => ({}))]);

      if (overview.ok) {
        setSnapshot((a?.snapshot as Snapshot | null) ?? null);
      } else {
        setSnapshot(null);
      }

      if (inventory.ok) {
        setTanks(Array.isArray(b?.tanks) ? b.tanks : []);
      } else {
        setTanks([]);
      }

      setState('ready');
    } catch {
      setSnapshot(null);
      setTanks([]);
      setState('error');
    }
  }, [stationId]);

  useEffect(() => {
    if (user && stationId !== null) load();
  }, [user, stationId, load]);

  const safeSnapshot: Snapshot = snapshot ?? {
    stock: { total_system: 0, total_available: 0, total_capacity: 0 },
    today: { sold: 0, delivered: 0, delivery_count: 0, sale_count: 0, total_collected: 0, total_cost: 0, total_profit: 0 },
    reconciliation: { total_variance: 0, open: 0 },
    attention: { critical_alerts: 0 },
    trend: [],
  };

  const totalSystemStock = useMemo(() => {
    const fromTanks = sumTankStock(tanks);
    return fromTanks || number(safeSnapshot.stock?.total_system ?? 0);
  }, [tanks, safeSnapshot.stock?.total_system]);

  const chartPoints = useMemo(() => {
    const source = snapshot?.trend && snapshot.trend.length > 0 ? snapshot.trend : [];
    if (!source.length) {
      return [{ label: 'اليوم', value: totalSystemStock }];
    }

    return source.slice(-7).map((point) => ({
      label: point.business_date ? new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short' }).format(new Date(point.business_date)) : 'اليوم',
      value: number(point.sold ?? 0),
    }));
  }, [snapshot?.trend, totalSystemStock]);

  const fuelCards = useMemo(() => {
    const map = new Map<string, { name: string; quantity: number; capacity: number; percent: number }>();

    const configuredFuels = Array.isArray((safeSnapshot as any).by_fuel) ? (safeSnapshot as any).by_fuel : [];
    for (const fuel of configuredFuels) {
      const name = fuel.fuel_name || fuel.fuel_code || 'وقود';
      map.set(name, { name, quantity: number(fuel.system_quantity), capacity: number(fuel.capacity), percent: 0 });
    }

    for (const tank of tanks) {
      const name = tank.fuel_name || tank.fuel_type || tank.tank_code || 'وقود';
      const quantity = number((tank as any).system_quantity ?? (tank as any).current_qty ?? (tank as any).current_stock ?? (tank as any).available_quantity ?? 0);
      const capacity = number(tank.capacity ?? tank.capacity_liters ?? 0);
      const current = map.get(name) ?? { name, quantity: 0, capacity: 0, percent: 0 };
      // The snapshot is already grouped by fuel. Use tank rows only when this
      // grade was not returned by it, avoiding duplicate totals.
      if (!configuredFuels.some((fuel: any) => (fuel.fuel_name || fuel.fuel_code || 'وقود') === name)) {
        current.quantity += quantity;
        current.capacity += capacity;
      }
      map.set(name, current);
    }

    const grouped = Array.from(map.values()).map((item) => ({
      ...item,
      percent: item.capacity > 0 ? (item.quantity / item.capacity) * 100 : 0,
    }));

    if (!grouped.length) {
      return [{ name: 'لا توجد بيانات خزانات', quantity: 0, capacity: 0, percent: 0 }];
    }

    return grouped.sort((a, b) => b.quantity - a.quantity);
  }, [tanks, safeSnapshot]);

  const totalCollectedFromSales = number(safeSnapshot.totals?.total_collected ?? safeSnapshot.today?.total_collected ?? 0);
  const totalCostFromDeliveries = number(safeSnapshot.totals?.total_cost ?? safeSnapshot.today?.total_cost ?? 0);
  const effectiveCollected = totalCollectedFromSales > 0 ? totalCollectedFromSales : 0;
  const effectiveCost = totalCostFromDeliveries > 0 ? totalCostFromDeliveries : 0;
  const effectiveProfit = number(safeSnapshot.totals?.total_profit ?? (effectiveCollected - effectiveCost));
  const soldLiters = number(safeSnapshot.today?.sold ?? 0) || 0;
  const saleOperations = number(safeSnapshot.today?.sale_count ?? 0) || 0;

  const cards: { title: string; value: unknown; unit: string; icon: IconName; hint: string }[] = [
    { title: 'المخزون الإجمالي', value: totalSystemStock, unit: 'لتر', icon: 'stock', hint: 'الرصد الحالي' },
    { title: 'إجمالي المقبوضات', value: effectiveCollected, unit: 'ج.م', icon: 'sales', hint: 'المبيعات المحصلة' },
    { title: 'إجمالي الربح', value: effectiveProfit, unit: 'ج.م', icon: 'adjust', hint: 'إجمالي الربح' },
    { title: 'كمية الوقود المباعة', value: soldLiters, unit: 'لتر', icon: 'operations', hint: `${saleOperations} عملية بيع` },
  ];

  const actions: { href: string; icon: IconName; label: string }[] = [
    { href: '/reconciliation', icon: 'adjust', label: 'تسوية وردية' },
    { href: '/tanks', icon: 'transfer', label: 'تحويل مخزون' },
    { href: '/deliveries/new', icon: 'plus', label: 'إضافة فاتورة شراء' },
    { href: '/sales/new', icon: 'sales', label: 'إضافة بيع' },
    { href: '/reports/daily', icon: 'report', label: 'عرض التقارير' },
  ];

  if (isLoading || state === 'loading') return <div className="app-main"><Header /><main className="dashboard-page"><LoadingState /></main></div>;
  if (!user) return null;

  return (
    <div className="app-main">
      <Header />
      <main className="dashboard-page">
        <section className="dash-title">
          <div>
            <h1>الرئيسية</h1>
            <p>نظرة عامة على أداء المحطة</p>
          </div>
          <button onClick={load}>اليوم: {new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long' }).format(new Date())}</button>
        </section>

        {state === 'error' && (
          <div className="mb-4 rounded border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-[var(--text-muted)]">
            تم تحميل البيانات الاحتياطية، يمكن إعادة المحاولة لاحقاً.
          </div>
        )}

        <section className="dash-kpis">
          {cards.map((card) => (
            <article key={card.title}>
              <span><Icon name={card.icon} /></span>
              <p>{card.title}</p>
              <strong>{format(card.value)}</strong>
              <small>{card.unit}</small>
              <footer><i />{card.hint}</footer>
            </article>
          ))}
        </section>

        <section className="dash-analytics">
          <article className="dash-panel">
            <header>
              <h2>المبيعات خلال آخر 7 أيام</h2>
              <small>المخطط يعكس كل يوم على حدة من نفس البيانات</small>
            </header>
            <Graph points={chartPoints} />
          </article>

          <article className="dash-panel">
            <header>
              <h2>المخزون الحالي في الخزانات</h2>
            </header>
            <div className="stock-summary">
              <div className="stock-ring">
                <div>
                  <small>إجمالي</small>
                  <b>{format(totalSystemStock)}</b>
                  <small>لتر</small>
                </div>
              </div>
              <div className="stock-list">
                {fuelCards.map((fuel, index) => (
                  <div key={`${fuel.name}-${index}`}>
                    <i className={`fuel-${index}`} />
                    <span>
                      <b>{fuel.name}</b>
                      <small>{format(fuel.quantity)} لتر</small>
                    </span>
                    <strong>{Math.round(fuel.percent)}%</strong>
                  </div>
                ))}
              </div>
            </div>
          </article>
        </section>

        <section className="dash-actions">
          <h2>إجراءات سريعة</h2>
          <div>
            {actions.map((action) => (
              <Link href={action.href} key={action.label}>
                <span><Icon name={action.icon} /></span>
                <b>{action.label}</b>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
