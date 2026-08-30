import React, { useState, useCallback, useRef, useEffect } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Reusable confirmation dialog for destructive actions
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'تأكيد',
  cancelText = 'إلغاء',
  isDangerous = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="ui-card form-card modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{title}</h3>
        <p className="text-sm text-gray-600 mt-2">{message}</p>
        <div className="flex gap-3 mt-4 justify-end">
          <button
            type="button"
            className="ui-button secondary"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`ui-button ${isDangerous ? 'danger' : ''}`}
            onClick={() => {
              onConfirm();
              onCancel();
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

interface FormModalProps {
  open: boolean;
  title: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode;
  submitText?: string;
  submitDisabled?: boolean;
}

/**
 * Reusable form modal with loading and error states
 */
export function FormModal({
  open,
  title,
  loading = false,
  error,
  onClose,
  onSubmit,
  children,
  submitText = 'حفظ',
  submitDisabled = false,
}: FormModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="ui-card form-card modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={loading}
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="form-grid">
          {children}

          {error && (
            <div className="form-error col-span-full">
              {error}
            </div>
          )}

          <div className="form-actions col-span-full">
            <button
              type="button"
              className="ui-button secondary flex-1"
              onClick={onClose}
              disabled={loading}
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="ui-button flex-1"
              disabled={loading || submitDisabled}
            >
              {loading ? (
                <>
                  <span className="button-spinner"></span>
                  جاري الحفظ...
                </>
              ) : (
                submitText
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DataGridProps<T> {
  data: T[];
  loading?: boolean;
  error?: string;
  columns: {
    key: string;
    label: string;
    render?: (value: any, row: T, index: number) => React.ReactNode;
  }[];
  actions?: {
    label: string;
    onClick: (row: T, index: number) => void;
    variant?: 'default' | 'danger' | 'secondary';
  }[];
  emptyMessage?: string;
  onRowClick?: (row: T, index: number) => void;
}

/**
 * Optimized data grid with loading and error states
 */
export function DataGrid<T>({
  data,
  loading = false,
  error,
  columns,
  actions = [],
  emptyMessage = 'لا توجد بيانات',
  onRowClick,
}: DataGridProps<T>) {
  if (error) {
    return (
      <div className="empty-state">
        <h3>حدث خطأ</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
            {actions.length > 0 && <th>الإجراءات</th>}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 3 }).map((_, i) => (
            <tr key={i} className="skeleton-row">
              {Array.from({ length: columns.length + (actions.length > 0 ? 1 : 0) }).map((_, j) => (
                <td key={j}>
                  <div className="skeleton-line" style={{ height: '16px', width: '80%' }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="empty-state">
        <h3>{emptyMessage}</h3>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
            {actions.length > 0 && <th>الإجراءات</th>}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr
              key={index}
              onClick={() => onRowClick?.(row, index)}
              style={{ cursor: onRowClick ? 'pointer' : 'default' }}
            >
              {columns.map((col) => (
                <td key={col.key} data-label={col.label}>
                  {col.render ? col.render(row[col.key as keyof T], row, index) : row[col.key as keyof T] as any}
                </td>
              ))}
              {actions.length > 0 && (
                <td>
                  <div className="flex gap-2">
                    {actions.map((action, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`ui-button ${action.variant || 'secondary'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          action.onClick(row, index);
                        }}
                        style={{ minHeight: '32px', padding: '0 11px', fontSize: '11px' }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Reusable toast/notification component
 */
export function Toast({
  message,
  type = 'info',
  duration = 3000,
  onClose,
}: {
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const timeout = setTimeout(onClose, duration);
    return () => clearTimeout(timeout);
  }, [duration, onClose]);

  return (
    <div className={`toast toast-${type}`}>
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="إغلاق">
        ×
      </button>
    </div>
  );
}

/**
 * Hook for managing toast notifications
 */
export function useToast() {
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'error' | 'warning' | 'info' }>>([]);

  const addToast = useCallback(
    (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
      const id = Math.random().toString(36).substr(2, 9);
      setToasts((prev) => [...prev, { id, message, type }]);
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}
