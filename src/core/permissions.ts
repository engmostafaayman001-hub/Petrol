/**
 * Capability model.
 *
 * This is the *second* line of defence and exists so the interface can be
 * honest about what a user can do. The authoritative check is the row-level
 * security policy in `20240101000900_rls.sql`; a request that slips past this
 * file still fails at the database.
 *
 * Capabilities, not roles, are used at call sites. Adding a third role later
 * means editing one table here rather than hunting for `role === 'manager'`.
 */

import type { UserRole } from './domain/enums';

export const CAPABILITIES = [
  // Operational capture
  'delivery:create',
  'sale:create',
  'measurement:record',
  'tank:transfer',
  'reconciliation:open',
  'reconciliation:close',
  'reconciliation:submit',
  'adjustment:request',
  'expense:create',
  'customer:manage',
  'customer:payment',
  'supplier:manage',
  'supplier:payment',
  'audit:read',
  'report:export',

  // Oversight
  'reconciliation:review',
  'adjustment:decide',
  'expense:decide',
  'record:void',

  // Configuration
  'tank:manage',
  'fuel_type:manage',
  'supplier:manage',
  'shift:manage',
  'price:manage',
  'settings:manage',
  'sensor:manage',

  // Administration
  'user:manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const SUPERVISOR_CAPABILITIES: readonly Capability[] = [
  'delivery:create',
  'sale:create',
  'measurement:record',
  'tank:transfer',
  'reconciliation:open',
  'reconciliation:close',
  'reconciliation:submit',
  'adjustment:request',
  'expense:create',
  'customer:manage',
  'customer:payment',
  'supplier:manage',
  'supplier:payment',
  'audit:read',
];

const ROLE_CAPABILITIES: Record<UserRole, ReadonlySet<Capability>> = {
  manager: new Set(CAPABILITIES),
  supervisor: new Set(SUPERVISOR_CAPABILITIES),
};

export function can(role: UserRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role].has(capability);
}

export function canAll(role: UserRole | null | undefined, capabilities: Capability[]): boolean {
  return capabilities.every((capability) => can(role, capability));
}

export function canAny(role: UserRole | null | undefined, capabilities: Capability[]): boolean {
  return capabilities.some((capability) => can(role, capability));
}

export const ROLE_LABELS: Record<UserRole, string> = {
  manager: 'Manager',
  supervisor: 'Supervisor',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  manager:
    'Full oversight. Configures tanks, grades and thresholds, reviews reconciliations, authorises adjustments and reads the audit trail.',
  supervisor:
    'Forecourt operations. Records deliveries, sales and closing measurements, and submits reconciliations. Cannot alter configuration or historical records.',
};
