import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/auth';

const links = [
  { href: '/', label: 'لوحة التحكم', icon: 'home' }, { href: '/sales', label: 'المبيعات', icon: 'receipt' },
  { href: '/deliveries', label: 'التوريدات', icon: 'truck' }, { href: '/tanks', label: 'الخزانات والمخزون', icon: 'tank' },
  { href: '/reconciliation', label: 'التسويات', icon: 'adjust' }, { href: '/ledger', label: 'دفتر العمليات', icon: 'ledger' },
  { href: '/reports/daily', label: 'التقارير', icon: 'chart' }, { href: '/users', label: 'المستخدمون والصلاحيات', icon: 'adjust' }, { href: '/settings', label: 'الإعدادات', icon: 'adjust' },
] as const;
type IconName = (typeof links)[number]['icon'];

function Icon({ name }: { name: IconName }) { const paths: Record<IconName, React.ReactNode> = { home: <><path d="M3 10.8 12 3l9 7.8v9.7H3z" /><path d="M9 21v-6h6v6" /></>, receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>, truck: <><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>, tank: <><path d="M6 7h12v11H6zM9 7V4h6v3M8 18v2m8-2v2" /><path d="M6 12h12" /></>, adjust: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></>, ledger: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>, chart: <><path d="M4 20V4m0 16h17" /><path d="m7 16 4-5 3 2 5-7" /></> }; return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }

export default function AppSidebar() {
  const router = useRouter(); const { user } = useAuth(); const initials = (user?.email?.slice(0, 1) || 'م').toUpperCase();
  const navigation = (mobile = false) => (mobile ? links.filter((link) => ['/', '/sales', '/deliveries', '/tanks', '/reports/daily', '/settings'].includes(link.href)) : links).map((link) => { const active = link.href === '/' ? router.pathname === '/' : router.pathname.startsWith(link.href); return <Link key={link.href} href={link.href} className={active ? 'active' : ''} title={link.label}><Icon name={link.icon} /><span>{mobile ? link.label.split(' ')[0] : link.label}</span></Link>; });
  return <><aside className="app-sidebar"><Link href="/" className="brand-lockup" aria-label="PETROL الرئيسية"><svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 2c-1 8-9 10-9 18a9 9 0 0 0 18 0c0-5-3-9-7-13 1 7-4 10-4 15-4-7 2-12 2-20Z" /></svg><span>PETROL<span className="brand-dot">.</span></span></Link><p className="brand-subtitle">نظام إدارة محطات الوقود</p><div className="sidebar-user"><span className="avatar">{initials}</span><div><b>{user?.email?.split('@')[0] || 'مدير المحطة'}</b><small><i />{user?.email?.toLowerCase() === 'markode@gmail.com' ? 'مدير المحطة' : 'متصل الآن'}</small></div></div><p className="sidebar-caption">إدارة المحطة</p><nav className="sidebar-nav" aria-label="التنقل الرئيسي">{navigation()}</nav><div className="sidebar-bottom"><span className="online-dot" /> جميع الأنظمة تعمل بشكل طبيعي</div></aside><nav className="mobile-nav" aria-label="التنقل السريع">{navigation(true)}</nav></>;
}
