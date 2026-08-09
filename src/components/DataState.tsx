import React from 'react';

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5" strokeLinecap="round"/></svg><h3>{title}</h3><p>{description}</p></div>;
}
export function LoadingState() { return <div className="empty-state" aria-label="جارٍ التحميل"><div className="mx-auto h-9 w-9 animate-spin rounded-full border-[3px] border-blue-100 border-t-blue-600" /><p className="mt-4">جارٍ تحميل البيانات…</p></div>; }
export function ErrorState({ onRetry }: { onRetry: () => void }) { return <div className="empty-state"><h3>تعذر تحميل البيانات</h3><p>تحقق من الاتصال ثم أعد المحاولة.</p><button className="ui-button mt-5" onClick={onRetry}>إعادة المحاولة</button></div>; }
