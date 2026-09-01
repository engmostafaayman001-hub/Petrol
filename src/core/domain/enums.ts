/**
 * Domain enumerations.
 *
 * These mirror the PostgreSQL enum types one-for-one. They are declared as
 * const arrays so the same values can be used for runtime validation (Zod) and
 * compile-time types without drifting apart.
 */

export const USER_ROLES = ['manager', 'supervisor'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TANK_STATUSES = ['operational', 'maintenance', 'decommissioned'] as const;
export type TankStatus = (typeof TANK_STATUSES)[number];

export const TXN_TYPES = [
  'opening_balance',
  'delivery',
  'sale',
  'adjustment',
  'variance_writeoff',
  'transfer_in',
  'transfer_out',
  'tank_transfer',
  'sensor_correction',
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const RECORD_STATUSES = ['active', 'voided'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const READING_TYPES = ['opening', 'closing', 'spot'] as const;
export type ReadingType = (typeof READING_TYPES)[number];

export const READING_SOURCES = ['manual', 'sensor', 'calculated'] as const;
export type ReadingSource = (typeof READING_SOURCES)[number];

export const VARIANCE_STATUSES = ['balanced', 'minor', 'warning', 'critical'] as const;
export type VarianceStatus = (typeof VARIANCE_STATUSES)[number];

export const RECONCILIATION_STATUSES = ['open', 'submitted', 'approved', 'rejected'] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const ADJUSTMENT_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_KINDS = [
  'tank_below_minimum',
  'tank_near_capacity',
  'large_variance',
  'missing_closing_measurement',
  'unreconciled_period',
  'unusual_sales_volume',
  'pending_approval',
  'sensor_offline',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const SENSOR_STATUSES = ['unconfigured', 'online', 'offline', 'error', 'disabled'] as const;
export type SensorStatus = (typeof SENSOR_STATUSES)[number];

export const ADJUSTMENT_REASON_CODES = [
  'metering_error',
  'evaporation_loss',
  'temperature_correction',
  'water_removal',
  'spillage',
  'theft_suspected',
  'delivery_discrepancy',
  'stock_take_correction',
  'data_entry_correction',
  'other',
] as const;
export type AdjustmentReasonCode = (typeof ADJUSTMENT_REASON_CODES)[number];

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReasonCode, string> = {
  metering_error: 'Metering error',
  evaporation_loss: 'Evaporation loss',
  temperature_correction: 'Temperature correction',
  water_removal: 'Water removal',
  spillage: 'Spillage',
  theft_suspected: 'Suspected theft',
  delivery_discrepancy: 'Delivery discrepancy',
  stock_take_correction: 'Stock-take correction',
  data_entry_correction: 'Data entry correction',
  other: 'Other',
};

export const TXN_TYPE_LABELS: Record<TxnType, string> = {
  opening_balance: 'Opening balance',
  delivery: 'Delivery',
  sale: 'Sale',
  adjustment: 'Adjustment',
  variance_writeoff: 'Variance',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  tank_transfer: 'Internal tank transfer',
  sensor_correction: 'Sensor correction',
};

export const VARIANCE_STATUS_LABELS: Record<VarianceStatus, string> = {
  balanced: 'Balanced',
  minor: 'Minor',
  warning: 'Warning',
  critical: 'Critical',
};

export const RECONCILIATION_STATUS_LABELS: Record<ReconciliationStatus, string> = {
  open: 'In progress',
  submitted: 'Awaiting review',
  approved: 'Signed off',
  rejected: 'Sent back',
};
