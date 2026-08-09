import React from 'react';
import { useTheme } from '../lib/theme';
export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();
  return <button type="button" onClick={toggleTheme} className="icon-button" aria-label={isDark ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن'} title={isDark ? 'الوضع الفاتح' : 'الوضع الداكن'}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{isDark ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41"/></> : <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z"/>}</svg></button>;
}
