/**
 * Variance classification.
 *
 * A faithful TypeScript mirror of `public.fn_classify_variance`. Both exist on
 * purpose: the database is authoritative when a reconciliation is submitted,
 * while this copy lets the end-of-day screen grade a measurement the instant it
 * is typed, before anything is sent to the server.
 *
 * `src/core/inventory/engine.test.ts` pins the two implementations to the same
 * worked examples so they cannot drift silently.
 */

import type { VarianceStatus } from '../domain/enums';

export interface VarianceThresholds {
  /** Dead band in base units. Anything inside it is balanced regardless of %. */
  absoluteTolerance: number;
  minorPct: number;
  warningPct: number;
  /** Above this a written explanation is mandatory before submission. */
  criticalPct: number;
}

export const DEFAULT_THRESHOLDS: VarianceThresholds = {
  absoluteTolerance: 5,
  minorPct: 0.3,
  warningPct: 0.75,
  criticalPct: 1.5,
};

export interface VarianceResult {
  quantity: number;
  percent: number;
  status: VarianceStatus;
  direction: 'shortage' | 'excess' | 'balanced';
  /** True when the operator must justify the difference before submitting. */
  requiresExplanation: boolean;
}

export function variancePercent(variance: number, expected: number): number {
  if (expected === 0) return variance === 0 ? 0 : 100;
  return round(variance / Math.abs(expected) * 100, 4);
}

export function classifyVariance(
  variance: number,
  expected: number,
  thresholds: VarianceThresholds = DEFAULT_THRESHOLDS,
): VarianceStatus {
  if (Math.abs(variance) <= thresholds.absoluteTolerance) return 'balanced';

  const percent = Math.abs(variancePercent(variance, expected));
  if (percent <= thresholds.minorPct) return 'minor';
  if (percent <= thresholds.warningPct) return 'warning';
  return 'critical';
}

export function evaluateVariance(
  actual: number,
  expected: number,
  thresholds: VarianceThresholds = DEFAULT_THRESHOLDS,
): VarianceResult {
  const quantity = round(actual - expected, 3);
  const percent = variancePercent(quantity, expected);
  const status = classifyVariance(quantity, expected, thresholds);

  return {
    quantity,
    percent,
    status,
    direction: status === 'balanced' ? 'balanced' : quantity < 0 ? 'shortage' : 'excess',
    requiresExplanation: Math.abs(percent) > thresholds.criticalPct,
  };
}

const SEVERITY_RANK: Record<VarianceStatus, number> = {
  balanced: 1,
  minor: 2,
  warning: 3,
  critical: 4,
};

export function worstStatus(statuses: Array<VarianceStatus | null | undefined>): VarianceStatus {
  return statuses.reduce<VarianceStatus>((worst, current) => {
    if (!current) return worst;
    return SEVERITY_RANK[current] > SEVERITY_RANK[worst] ? current : worst;
  }, 'balanced');
}

export function varianceRank(status: VarianceStatus): number {
  return SEVERITY_RANK[status];
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
