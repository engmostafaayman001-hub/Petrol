import React, { createContext, useCallback, useContext, useState } from 'react';

type Tone = 'success' | 'error' | 'warning' | 'info';
type Toast = { id: number; message: string; tone: Tone };
const ToastContext = createContext<{ notify: (message: string, tone?: Tone) => void }>({ notify: () => undefined });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((message: string, tone: Tone = 'success') => {
    const id = Date.now(); setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4500);
  }, []);
  return <ToastContext.Provider value={{ notify }}>{children}<div className="toast-region" aria-live="polite" aria-relevant="additions">{toasts.map((toast) => <div key={toast.id} className={`toast toast-${toast.tone}`} role="status"><span>{toast.message}</span><button type="button" aria-label="إغلاق التنبيه" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}>×</button></div>)}</div></ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);
