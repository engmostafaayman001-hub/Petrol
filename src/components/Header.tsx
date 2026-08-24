import React from 'react';
import ThemeToggle from './ThemeToggle';
import AppSidebar from './AppSidebar';

export default function Header({ title = 'الرئيسية', description = 'نظرة عامة على أداء المحطة اليوم', actions }: { title?: string; description?: string; actions?: React.ReactNode }) {
  const today = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  return (
    <>
      <AppSidebar />
      <header className="app-topbar">
        <div className="topbar-heading"><h1>{title}</h1><p>{description}</p></div>
        <div className="top-actions">{actions}<button type="button" className="ui-button secondary no-print" onClick={() => window.print()} aria-label="طباعة الصفحة">طباعة</button><span className="date-pill">{today}</span><ThemeToggle /><button type="button" className="icon-button" aria-label="الإشعارات"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" strokeLinecap="round" strokeLinejoin="round"/></svg></button></div>
      </header>
    </>
  );
}
