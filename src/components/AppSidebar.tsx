import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { can, type Capability } from '../core/permissions';

type IconName = 'home' | 'sales' | 'service' | 'truck' | 'tank' | 'shift' | 'ledger' | 'chart' | 'settings' | 'users' | 'expense';
type Item = { href: string; label: string; icon: IconName; capability?: Capability };
const groups: { label: string; items: Item[] }[] = [
  { label: 'الرئيسية', items: [{ href: '/', label: 'لوحة التحكم', icon: 'home' }, { href: '/reconciliation', label: 'الوردية الحالية', icon: 'shift', capability: 'reconciliation:open' }] },
  { label: 'العمليات', items: [{ href: '/sales', label: 'المبيعات', icon: 'sales', capability: 'sale:create' }, { href: '/deliveries', label: 'التوريدات', icon: 'truck', capability: 'delivery:create' }, { href: '/services', label: 'الخدمات', icon: 'service', capability: 'sale:create' }, { href: '/tanks', label: 'الخزانات والمخزون', icon: 'tank', capability: 'tank:manage' }] },
  { label: 'المتابعة', items: [{ href: '/ledger', label: 'سجل العمليات', icon: 'ledger', capability: 'audit:read' }, { href: '/expenses', label: 'المصروفات', icon: 'expense', capability: 'expense:create' }, { href: '/reports/daily', label: 'التقارير', icon: 'chart', capability: 'report:export' }] },
  { label: 'الإدارة', items: [{ href: '/users', label: 'المستخدمون والصلاحيات', icon: 'users', capability: 'user:manage' }, { href: '/settings', label: 'الإعدادات', icon: 'settings', capability: 'settings:manage' }] },
];

function Icon({ name }: { name: IconName }) { const p: Record<IconName, React.ReactNode> = { home: <><path d="M3 10.8 12 3l9 7.8v9.7H3z"/><path d="M9 21v-6h6v6"/></>, sales: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8m-8 4h4"/></>, service: <><path d="M4 18h16"/><path d="m7 15 3-6 2 4 3-7 2 9"/></>, truck: <><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></>, tank: <><path d="M6 7h12v11H6zM9 7V4h6v3M8 18v2m8-2v2"/><path d="M6 12h12"/></>, shift: <><path d="M12 3v9l6 3"/><circle cx="12" cy="12" r="9"/></>, ledger: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>, chart: <><path d="M4 20V4m0 16h17"/><path d="m7 16 4-5 3 2 5-7"/></>, settings: <><circle cx="12" cy="12" r="3"/><path d="M19 12h2M3 12h2M12 3v2m0 14v2M18.4 5.6l-1.4 1.4M7 17l-1.4 1.4M18.4 18.4 17 17M7 7 5.6 5.6"/></>, users: <><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0-1-5.83M18 20a5 5 0 0 0-3-4.58"/></>, expense: <><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h5M12 3v2"/></> }; return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p[name]}</svg>; }

export default function AppSidebar() {
  const router = useRouter(); const { user, role, signOut } = useAuth(); const [mobileOpen, setMobileOpen] = useState(false); const [isSigningOut, setIsSigningOut] = useState(false); const initials = (user?.email?.slice(0, 1) || 'م').toUpperCase();
  const visible = groups.map((group) => ({ ...group, items: group.items.filter((item) => !item.capability || can(role, item.capability)) })).filter((group) => group.items.length);
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = ''; };
  }, [mobileOpen]);
  const nav = (item: Item, compact = false) => { const active = item.href === '/' ? router.pathname === '/' : router.pathname.startsWith(item.href); return <Link key={item.href} href={item.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => setMobileOpen(false)}><Icon name={item.icon}/><span>{compact ? item.label.split(' ')[0] : item.label}</span></Link>; };
  async function handleSignOut() { if (isSigningOut) return; setIsSigningOut(true); setMobileOpen(false); await signOut(); await router.replace('/signin'); }
  const mobile = visible.flatMap((group) => group.items).filter((item) => ['/', '/reconciliation', '/sales', '/deliveries', '/services'].includes(item.href));
  return <><button type="button" className="mobile-menu-toggle" aria-label={mobileOpen ? 'إغلاق القائمة' : 'فتح القائمة'} aria-expanded={mobileOpen} aria-controls="app-sidebar" onClick={() => setMobileOpen((open) => !open)}><span/><span/><span/></button>{mobileOpen && <button type="button" className="sidebar-backdrop" aria-label="إغلاق القائمة" onClick={() => setMobileOpen(false)}/>}<aside id="app-sidebar" className={`app-sidebar${mobileOpen ? ' mobile-open' : ''}`}><Link href="/" className="brand-lockup" aria-label="Al Taawoun الرئيسية"><svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 2c-1 8-9 10-9 18a9 9 0 0 0 18 0c0-5-3-9-7-13 1 7-4 10-4 15-4-7 2-12 2-20Z"/></svg><span>Al Taawoun<span className="brand-dot">.</span></span></Link><p className="brand-subtitle">نظام إدارة محطات الوقود</p><div className="sidebar-user"><span className="avatar">{initials}</span><div><b>{user?.email?.split('@')[0] || 'مستخدم المحطة'}</b><small><i/> {role === 'manager' ? 'مدير المحطة' : 'مشرف وردية'}</small></div></div><nav className="sidebar-nav" aria-label="التنقل الرئيسي">{visible.map((group) => <section key={group.label}><p className="sidebar-caption">{group.label}</p>{group.items.map((item) => nav(item))}</section>)}</nav><button type="button" className="sidebar-logout" onClick={handleSignOut} disabled={isSigningOut} aria-busy={isSigningOut}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5m5 5H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></svg><span>{isSigningOut ? 'جار تسجيل الخروج...' : 'تسجيل الخروج'}</span></button><div className="sidebar-bottom"><span className="online-dot"/> النظام متصل</div></aside><nav className="mobile-nav" aria-label="التنقل السريع">{mobile.map((item) => nav(item, true))}</nav></>;
}
