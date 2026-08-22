import React from 'react';
import clsx from 'clsx';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
};

export function Button({ variant = 'primary', loading = false, className, children, disabled, ...props }: ButtonProps) {
  return <button {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={clsx('ui-button', variant !== 'primary' && variant, className)}>
    {loading && <span className="button-spinner" aria-hidden="true" />}{children}
  </button>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return <header className="page-heading page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div className="page-header-actions">{actions}</div>}</header>;
}

export function StatusBadge({ tone = 'neutral', children }: { tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; children: React.ReactNode }) {
  return <span className={clsx('status-badge', `status-${tone}`)}>{children}</span>;
}

export function SectionCard({ title, description, actions, children, className }: { title?: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={clsx('ui-card section-card', className)}>{(title || actions) && <header className="section-card-header"><div>{title && <h3>{title}</h3>}{description && <p>{description}</p>}</div>{actions && <div>{actions}</div>}</header>}{children}</section>;
}

export function StatCard({ label, value, hint, tone = 'brand' }: { label: string; value: React.ReactNode; hint?: string; tone?: 'brand' | 'success' | 'warning' | 'danger' }) {
  return <article className={clsx('stat-card', `stat-${tone}`)}><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</article>;
}
