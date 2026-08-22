import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/auth';
import { can } from '../core/permissions';

const supervisorRoutes = new Set(['/', '/sales', '/sales/new', '/deliveries', '/deliveries/new', '/services', '/services/new', '/reconciliation', '/reconciliation/session', '/expenses']);
const supervisorRouteCapabilities: Array<{ prefix: string; capability: Parameters<typeof can>[1] }> = [
  { prefix: '/services', capability: 'sale:create' },
  { prefix: '/reports/daily', capability: 'report:export' },
  { prefix: '/tanks', capability: 'tank:manage' },
  { prefix: '/settings', capability: 'settings:manage' },
  { prefix: '/users', capability: 'user:manage' },
  { prefix: '/ledger', capability: 'audit:read' },
  { prefix: '/adjustments', capability: 'adjustment:request' },
];

export default function RoleRouteGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, role, isLoading } = useAuth();
  const isPublic = ['/signin', '/forgot-password', '/reset-password'].includes(router.pathname);
  const restrictedRoute = supervisorRouteCapabilities.find(({ prefix }) => router.pathname === prefix || router.pathname.startsWith(`${prefix}/`));
  const allowed = restrictedRoute ? can(role, restrictedRoute.capability) : supervisorRoutes.has(router.pathname);

  useEffect(() => {
    if (!isLoading && user && role === 'supervisor' && !isPublic && !allowed) {
      router.replace('/');
    }
  }, [allowed, isLoading, isPublic, role, router, user]);

  if (!isPublic && user && role === 'supervisor' && !allowed) return null;
  return <>{children}</>;
}
