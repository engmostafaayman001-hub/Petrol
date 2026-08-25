import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import PageLayout from '../src/components/PageLayout';
import { useRequireAuth } from '../src/lib/auth';
import { useRole } from '../src/lib/auth';
import { can } from '../src/core/permissions';
import supabase from '../src/lib/supabaseClient';
import { ErrorState, LoadingState } from '../src/components/DataState';
import { sumTankStock } from '../src/core/inventory/engine';

type Snapshot = {
  session?: { id: string; business_date?: string; status?: string; opened_at?: string; opened_by_name?: string; total_variance?: number } | null;
  services?: Array<{ amount?: number }>;
  by_fuel?: Array<{ fuel_name?: string; fuel_code?: string; sold_quantity?: number; delivered_quantity?: number; collected?: number; delivered_cost?: number; system_quantity?: number; capacity?: number }>;
  stock?: { total_system?: number; total_available?: number; total_capacity?: number };
  today?: {
    sold?: number;
    delivered?: number;
    delivery_count?: number;
    sale_count?: number;
    service_count?: number;
    total_services?: number;
    total_collected?: number;
    total_revenue?: number;
    total_remaining?: number;
    total_cost?: number;
    total_profit?: number;
    total_expenses?: number;
    meter_sold?: number;
  };
  totals?: { total_collected?: number; total_revenue?: number; total_remaining?: number; total_cost?: number; total_profit?: number; total_services?: number; total_expenses?: number };
  reconciliation?: { total_variance?: number; open?: number };
  attention?: { critical_alerts?: number };
  trend?: Array<{ business_date?: string; closing_stock?: number; sold?: number; delivered?: number; variance?: number }>;
};
type Tank = { tank_id: string; fuel_type_id?: string; tank_code?: string; fuel_name?: string; fuel_type?: string; system_quantity?: number; current_qty?: number; current_stock?: number; capacity?: number; capacity_liters?: number; fill_pct?: number; percentage?: number };
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
  const { role } = useRole();
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
      const { data: authData } = await supabase.auth.getSession();
      const headers: HeadersInit = authData.session?.access_token ? { Authorization: `Bearer ${authData.session.access_token}` } : {};
      const [overview, inventory] = await Promise.all([
        fetch(`/api/station/snapshot?stationId=${encodeURIComponent(stationId)}`, { headers }),
        fetch(`/api/tanks?stationId=${encodeURIComponent(stationId)}`, { headers }),
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
    const source = snapshot?.by_fuel && snapshot.by_fuel.length > 0 ? snapshot.by_fuel : [];
    if (!source.length) {
      return [];
    }

    return source.slice(-7).map((point) => ({
      label: point.fuel_name || point.fuel_code || 'وقود',
      value: number(point.sold_quantity ?? 0),
    }));
  }, [snapshot?.by_fuel]);

  const fuelCards = useMemo(() => {
    const map = new Map<string, { name: string; quantity: number; capacity: number; percent: number }>();

    for (const tank of tanks) {
      const name = tank.fuel_name || tank.fuel_type || tank.tank_code || 'وقود';
      const key = tank.fuel_type_id || name;
      const quantity = number((tank as any).system_quantity ?? (tank as any).current_qty ?? (tank as any).current_stock ?? (tank as any).available_quantity ?? 0);
      const capacity = number(tank.capacity ?? tank.capacity_liters ?? 0);
      const current = map.get(key) ?? { name, quantity: 0, capacity: 0, percent: 0 };
      current.quantity += quantity;
      current.capacity += capacity;
      map.set(key, current);
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

  const stockRingGradient = useMemo(() => {
    const total = fuelCards.reduce((sum, fuel) => sum + fuel.quantity, 0);
    if (total <= 0) return '#dbe5f2';
    const colors = ['#1769f5', '#00a9d8', '#315b9a', '#16a34a', '#f59e0b'];
    let cursor = 0;
    const segments = fuelCards.map((fuel, index) => {
      const next = cursor + (fuel.quantity / total) * 100;
      const segment = `${colors[index % colors.length]} ${cursor.toFixed(2)}% ${next.toFixed(2)}%`;
      cursor = next;
      return segment;
    });
    return `conic-gradient(${segments.join(', ')})`;
  }, [fuelCards]);

  const totalCollectedFromSales = number(safeSnapshot.totals?.total_collected ?? safeSnapshot.today?.total_collected ?? 0);
  const totalRemaining = number(safeSnapshot.totals?.total_remaining ?? safeSnapshot.today?.total_remaining ?? 0);
  const totalCostFromDeliveries = number(safeSnapshot.totals?.total_cost ?? safeSnapshot.today?.total_cost ?? 0);
  const effectiveCollected = totalCollectedFromSales > 0 ? totalCollectedFromSales : 0;
  const effectiveCost = totalCostFromDeliveries > 0 ? totalCostFromDeliveries : 0;
  const soldLiters = number(safeSnapshot.today?.sold ?? 0) || 0;
  const saleOperations = number(safeSnapshot.today?.sale_count ?? 0) || 0;
  const serviceIncome = number(safeSnapshot.totals?.total_services ?? safeSnapshot.today?.total_services ?? 0);
  const serviceOperations = number(safeSnapshot.today?.service_count ?? 0);
  const expenseTotal = number(safeSnapshot.totals?.total_expenses ?? safeSnapshot.today?.total_expenses ?? 0);
  const effectiveProfit = number(safeSnapshot.totals?.total_profit ?? (effectiveCollected - effectiveCost - expenseTotal));

  const cards: { title: string; value: unknown; unit: string; icon: IconName; hint: string }[] = [
    { title: 'المخزون الإجمالي', value: totalSystemStock, unit: 'لتر', icon: 'stock', hint: 'الرصد الحالي' },
    { title: 'إجمالي المحصل', value: effectiveCollected, unit: 'ج.م', icon: 'sales', hint: 'المبيعات المحصلة' },
    { title: 'المبيعات الآجلة', value: totalRemaining, unit: 'ج.م', icon: 'sales', hint: 'المتبقي من مبيعات الجلسة' },
    { title: 'إجمالي التوريدات', value: safeSnapshot.today?.delivered ?? 0, unit: 'لتر', icon: 'operations', hint: `${format(effectiveCost)} ج.م تكلفة التوريد` },
    { title: 'دخل الخدمات', value: serviceIncome, unit: 'ج.م', icon: 'sales', hint: `${serviceOperations} خدمة في الجلسة` },
    { title: 'إجمالي المصروفات', value: expenseTotal, unit: 'ج.م', icon: 'operations', hint: 'المصروفات المعتمدة في الجلسة' },
    { title: 'كمية الوقود المباعة', value: soldLiters, unit: 'لتر', icon: 'operations', hint: `${saleOperations} عملية بيع` },
    { title: 'إجمالي السحب من العدادات', value: safeSnapshot.today?.meter_sold ?? 0, unit: 'لتر', icon: 'operations', hint: 'مجموع فروق قراءات الجلسة' },
  ];

  const actions: { href: string; icon: IconName; label: string }[] = [
    { href: '/reconciliation', icon: 'adjust', label: 'تسوية وردية' },
    { href: '/tanks', icon: 'transfer', label: 'تحويل مخزون' },
    { href: '/deliveries/new', icon: 'plus', label: 'إضافة فاتورة شراء' },
    { href: '/sales/new', icon: 'sales', label: 'إضافة بيع' },
    { href: '/reports/daily', icon: 'report', label: 'عرض التقارير' },
  ];

  if (isLoading || state === 'loading') return <PageLayout title="لوحة التحكم"><div className="dashboard-page"><LoadingState /></div></PageLayout>;
  if (!user) return null;

  return (
    <PageLayout title="لوحة التحكم" description="نظرة سريعة على أداء المحطة والوردية الحالية">
      <div className="dashboard-page">
        <section className="dash-title">
          <div>
            <h1>الرئيسية</h1>
            <p>نظرة عامة على أداء المحطة</p>
          </div>
          <button onClick={load}>اليوم: {new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long' }).format(new Date())}</button>
        </section>

        {safeSnapshot.session ? (
          <section className="mb-5 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-right">
            <strong>الجلسة الحالية مفتوحة</strong>
            <span className="mr-3 text-sm text-[var(--text-muted)]">
              {safeSnapshot.session.business_date || '—'} · {safeSnapshot.session.opened_by_name || 'المستخدم المسؤول'} · بدأت {safeSnapshot.session.opened_at ? new Date(safeSnapshot.session.opened_at).toLocaleString('ar-EG') : '—'}
            </span>
          </section>
        ) : (
          <section className="mb-5 rounded border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-right">
            <strong>لا توجد جلسة مفتوحة حاليًا</strong>
          </section>
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
              <h2>مبيعات الجلسة الحالية حسب الوقود</h2>
              <small>يعرض عمليات الجلسة المفتوحة فقط</small>
            </header>
            <Graph points={chartPoints} />
          </article>

          <article className="dash-panel">
            <header>
              <h2>المخزون الحالي في الخزانات</h2>
            </header>
            <div className="stock-summary">
              <div className="stock-ring" style={{ background: stockRingGradient }}>
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
            {actions.filter((action) => (action.href !== '/reports/daily' || can(role, 'report:export')) && (action.href !== '/tanks' || can(role, 'tank:manage'))).map((action) => (
              <Link href={action.href} key={action.label}>
                <span><Icon name={action.icon} /></span>
                <b>{action.label}</b>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </PageLayout>
  );
}
