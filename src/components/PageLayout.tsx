import React from 'react';
import Header from './Header';

interface PageLayoutProps { title?: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; }

export default function PageLayout({ title = 'إدارة المحطة', description, actions, children }: PageLayoutProps) {
  return (
    <div dir="rtl" className="app-main">
      <Header title={title} description={description} actions={actions} />
      <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
