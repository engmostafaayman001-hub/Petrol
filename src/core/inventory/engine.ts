/**
 * Inventory calculation engine.
 *
 * Pure functions over plain numbers: no database, no React, no framework. This
 * is what makes the arithmetic testable and what will let a future sensor
 * pipeline reuse the same maths without touching the UI.
 *
 * The one rule the whole product rests on:
 *
 *     expected closing = opening + deliveries − sales + authorised adjustments
 *     variance         = actual closing − expected closing
 */

import { roundVolume } from '../units';
import type { TankStatusView } from '../domain/models';
import { evaluateVariance, worstStatus, type VarianceResult, type VarianceThresholds } from './variance';

export interface PeriodMovements {
  opening: number;
  delivered: number;
  sold: number;
  /** Signed: negative values write stock off. */
  adjusted: number;
}

export function expectedClosing(movements: PeriodMovements): number {
  return roundVolume(movements.opening + movements.delivered - movements.sold + movements.adjusted);
}

export interface ReconciliationInput extends PeriodMovements {
  tankId: string;
  actual: number | null;
}

export interface ReconciliationComputation {
  tankId: string;
  opening: number;
  delivered: number;
  sold: number;
  adjusted: number;
  expected: number;
  actual: number | null;
  variance: VarianceResult | null;
}

export function computeLine(
  input: ReconciliationInput,
  thresholds: VarianceThresholds,
): ReconciliationComputation {
  const expected = expectedClosing(input);

  return {
    tankId: input.tankId,
    opening: roundVolume(input.opening),
    delivered: roundVolume(input.delivered),
    sold: roundVolume(input.sold),
    adjusted: roundVolume(input.adjusted),
    expected,
    actual: input.actual === null ? null : roundVolume(input.actual),
    variance: input.actual === null ? null : evaluateVariance(input.actual, expected, thresholds),
  };
}

export interface SessionTotals {
  opening: number;
  delivered: number;
  sold: number;
  adjusted: number;
  expected: number;
  actual: number;
  variance: number;
  variancePct: number;
  worst: ReturnType<typeof worstStatus>;
  measured: number;
  pending: number;
  needsExplanation: string[];
}

export function summarise(lines: ReconciliationComputation[]): SessionTotals {
  const totals = lines.reduce(
    (acc, line) => {
      acc.opening += line.opening;
      acc.delivered += line.delivered;
      acc.sold += line.sold;
      acc.adjusted += line.adjusted;
      acc.expected += line.expected;
      acc.actual += line.actual ?? 0;
      acc.variance += line.variance?.quantity ?? 0;
      if (line.actual === null) acc.pending += 1;
      else acc.measured += 1;
      return acc;
    },
    { opening: 0, delivered: 0, sold: 0, adjusted: 0, expected: 0, actual: 0, variance: 0, measured: 0, pending: 0 },
  );

  return {
    opening: roundVolume(totals.opening),
    delivered: roundVolume(totals.delivered),
    sold: roundVolume(totals.sold),
    adjusted: roundVolume(totals.adjusted),
    expected: roundVolume(totals.expected),
    actual: roundVolume(totals.actual),
    variance: roundVolume(totals.variance),
    variancePct: totals.expected === 0 ? 0 : roundVolume((totals.variance / Math.abs(totals.expected)) * 100),
    worst: worstStatus(lines.map((line) => line.variance?.status ?? null)),
    measured: totals.measured,
    pending: totals.pending,
    needsExplanation: lines.filter((line) => line.variance?.requiresExplanation).map((line) => line.tankId),
  };
}

// ---------------------------------------------------------------------------
// Movement validation
//
// Mirrors the guards inside `fn_post_transaction` so a form can refuse an
// impossible entry before the round trip. The database remains the authority.
// ---------------------------------------------------------------------------

export interface MovementLimits {
  capacity: number;
  maxOperatingLevel: number;
  currentQuantity: number;
  allowNegative: boolean;
  enforceCapacity: boolean;
}

export type MovementCheck = { ok: true } | { ok: false; message: string };

export function checkIncoming(quantity: number, limits: MovementLimits, unitLabel = 'L'): MovementCheck {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, message: 'Enter a quantity greater than zero.' };
  }

  const resulting = limits.currentQuantity + quantity;

  if (limits.enforceCapacity && resulting > limits.capacity) {
    const room = Math.max(limits.capacity - limits.currentQuantity, 0);
    return {
      ok: false,
      message: `Only ${Math.floor(room).toLocaleString('en-GB')} ${unitLabel} will fit. The tank holds ${limits.capacity.toLocaleString('en-GB')} ${unitLabel} and currently has ${Math.round(limits.currentQuantity).toLocaleString('en-GB')} ${unitLabel}.`,
    };
  }

  if (resulting > limits.maxOperatingLevel) {
    return {
      ok: false,
      message: `This drop would exceed the safe working level of ${limits.maxOperatingLevel.toLocaleString('en-GB')} ${unitLabel}. Reduce the quantity or split the load.`,
    };
  }

  return { ok: true };
}

export function checkOutgoing(quantity: number, limits: MovementLimits, unitLabel = 'L'): MovementCheck {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, message: 'Enter a quantity greater than zero.' };
  }

  if (!limits.allowNegative && quantity > limits.currentQuantity) {
    return {
      ok: false,
      message: `Only ${Math.round(limits.currentQuantity).toLocaleString('en-GB')} ${unitLabel} is recorded in this tank. Record the delivery first if fuel arrived before this sale.`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tank health
// ---------------------------------------------------------------------------

export type TankLevelBand = 'critical' | 'low' | 'healthy' | 'high';

export function tankLevelBand(tank: Pick<TankStatusView, 'system_quantity' | 'capacity' | 'min_safe_level' | 'max_operating_level'>): TankLevelBand {
  if (tank.system_quantity <= tank.min_safe_level) return 'critical';
  if (tank.capacity > 0 && tank.system_quantity <= tank.min_safe_level * 1.35) return 'low';
  if (tank.system_quantity >= tank.max_operating_level) return 'high';
  return 'healthy';
}

/**
 * How long the current stock lasts at the recent burn rate. Returns null when
 * there is not enough history to make an honest estimate rather than guessing.
 */
export function daysOfCover(availableQuantity: number, averageDailySales: number): number | null {
  if (averageDailySales <= 0) return null;
  return Math.round((availableQuantity / averageDailySales) * 10) / 10;
}

export function fillPercent(quantity: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.min(100, Math.max(0, roundVolume((quantity / capacity) * 100)));
}

export function sumTankStock(
  tanks: Array<{ system_quantity?: number; current_qty?: number; current_stock?: number; available_quantity?: number }>,
): number {
  const total = tanks.reduce((sum, tank) => {
    const quantity = Number(
      tank.system_quantity ?? tank.current_qty ?? tank.current_stock ?? tank.available_quantity ?? 0,
    );
    return sum + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);

  return roundVolume(total);
}

export function aggregateCollectedAndProfit(
  sales: Array<{ gross_amount?: number; unit_price?: number; quantity?: number }> = [],
  deliveries: Array<{ quantity?: number; unit_cost?: number }> = [],
) {
  const collected = sales.reduce((sum, sale) => {
    const gross = Number(sale.gross_amount ?? ((sale.unit_price ?? 0) * (sale.quantity ?? 0)));
    return sum + (Number.isFinite(gross) ? gross : 0);
  }, 0);

  const cost = deliveries.reduce((sum, delivery) => {
    const totalCost = Number((delivery.unit_cost ?? 0) * (delivery.quantity ?? 0));
    return sum + (Number.isFinite(totalCost) ? totalCost : 0);
  }, 0);

  return {
    collected: roundVolume(collected),
    cost: roundVolume(cost),
    profit: roundVolume(collected - cost),
  };
}
