/**
 * Read models.
 *
 * Hand-written rather than generated so the application depends on the shape it
 * actually needs, not on every column of every table. Repositories are the only
 * place these are constructed; nothing above the data layer touches raw rows.
 *
 * If you prefer generated types, `supabase gen types typescript` can produce a
 * `Database` type and the repositories can be re-pointed at it without any
 * change above the data layer.
 */

import type {
  AdjustmentStatus,
  NotificationKind,
  NotificationSeverity,
  ReadingSource,
  ReadingType,
  ReconciliationStatus,
  RecordStatus,
  SensorStatus,
  TankStatus,
  TxnType,
  UserRole,
  VarianceStatus,
} from './enums';

export interface Station {
  id: string;
  code: string;
  name: string;
  legal_name: string | null;
  address: string | null;
  city: string | null;
  country_code: string | null;
  timezone: string;
  currency_code: string;
  base_unit_code: string;
  is_active: boolean;
}

export interface Profile {
  id: string;
  station_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
}

export interface Shift {
  id: string;
  station_id: string;
  code: string;
  name: string;
  starts_at: string;
  ends_at: string;
  seq: number;
  is_active: boolean;
}

export interface SystemSettings {
  station_id: string;
  variance_abs_tolerance: number;
  variance_minor_pct: number;
  variance_warning_pct: number;
  variance_critical_pct: number;
  tank_low_level_pct: number;
  tank_high_level_pct: number;
  unusual_sales_factor: number;
  allow_negative_balance: boolean;
  enforce_tank_capacity: boolean;
  require_adjustment_approval: boolean;
  post_variance_on_submit: boolean;
  volume_decimals: number;
  updated_at: string;
}

export interface FuelType {
  id: string;
  station_id: string;
  code: string;
  name: string;
  display_unit_code: string;
  selling_price: number | null;
  purchase_price: number | null;
  color_hex: string;
  sort_order: number;
  is_active: boolean;
  notes: string | null;
}

export interface Supplier {
  id: string;
  station_id: string;
  code: string;
  name: string;
  contact_name: string | null;
  contact_phone: string | null;
  is_active: boolean;
}

export interface Tank {
  id: string;
  station_id: string;
  code: string;
  name: string;
  fuel_type_id: string;
  capacity: number;
  max_operating_level: number;
  min_safe_level: number;
  dead_stock: number;
  status: TankStatus;
  is_active: boolean;
  installed_on: string | null;
  notes: string | null;
}

/** Shape returned by `public.v_tank_status`. */
export interface TankStatusView {
  tank_id: string;
  station_id: string;
  tank_code: string;
  tank_name: string;
  status: TankStatus;
  is_active: boolean;
  capacity: number;
  max_operating_level: number;
  min_safe_level: number;
  dead_stock: number;
  notes: string | null;

  fuel_type_id: string;
  fuel_code: string;
  fuel_name: string;
  fuel_color: string;
  selling_price: number | null;

  system_quantity: number;
  available_quantity: number;
  last_movement_at: string | null;
  fill_pct: number;
  min_level_pct: number;
  below_minimum: boolean;
  ullage: number;

  /** Latest physical measurement, whatever produced it. */
  measured_quantity: number | null;
  measured_source: ReadingSource | null;
  measured_at: string | null;
  measured_delta: number | null;

  sensor_device_id: string | null;
  sensor_status: SensorStatus | null;
  sensor_last_reading_at: string | null;
}

export interface LedgerEntry {
  id: number;
  station_id: string;
  tank_id: string;
  tank_code: string;
  fuel_type_id: string;
  fuel_code: string;
  fuel_name: string;
  fuel_color: string;
  txn_type: TxnType;
  quantity_delta: number;
  running_balance: number;
  business_date: string;
  shift_id: string | null;
  shift_code: string | null;
  shift_name: string | null;
  occurred_at: string;
  source_table: string;
  source_id: string | null;
  reverses_txn_id: number | null;
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface DeliveryView {
  id: string;
  station_id: string;
  tank_id: string;
  tank_code: string;
  tank_name: string;
  fuel_type_id: string;
  fuel_code: string;
  fuel_name: string;
  fuel_color: string;
  supplier_id: string | null;
  supplier_name: string | null;
  business_date: string;
  shift_id: string;
  shift_code: string;
  shift_name: string;
  delivered_at: string;
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  tanker_ref: string | null;
  driver_name: string | null;
  reference_no: string | null;
  meter_before: number | null;
  meter_after: number | null;
  notes: string | null;
  status: RecordStatus;
  created_by_name: string | null;
  created_at: string;
  voided_by_name: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface SaleView {
  id: string;
  station_id: string;
  tank_id: string;
  tank_code: string;
  tank_name: string;
  fuel_type_id: string;
  fuel_code: string;
  fuel_name: string;
  fuel_color: string;
  business_date: string;
  shift_id: string;
  shift_code: string;
  shift_name: string;
  quantity: number;
  unit_price: number | null;
  gross_amount: number | null;
  pump_label: string | null;
  nozzle_label: string | null;
  meter_open: number | null;
  meter_close: number | null;
  notes: string | null;
  status: RecordStatus;
  created_by_name: string | null;
  created_at: string;
  voided_by_name: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface AdjustmentView {
  id: string;
  station_id: string;
  tank_id: string;
  tank_code: string;
  fuel_type_id: string;
  fuel_code: string;
  fuel_name: string;
  business_date: string;
  shift_id: string | null;
  quantity_delta: number;
  reason_code: string;
  reason: string;
  status: AdjustmentStatus;
  ledger_txn_id: number | null;
  requested_by_name: string | null;
  requested_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  corrects_delivery_id: string | null;
  corrects_sale_id: string | null;
}

export interface ReconciliationSessionView {
  id: string;
  station_id: string;
  business_date: string;
  shift_id: string;
  shift_code: string;
  shift_name: string;
  shift_seq: number;
  status: ReconciliationStatus;
  total_opening: number;
  total_delivered: number;
  total_sold: number;
  total_adjusted: number;
  total_expected: number;
  total_actual: number;
  total_variance: number;
  worst_status: VarianceStatus;
  opened_by_name: string | null;
  opened_at: string;
  submitted_by_name: string | null;
  submitted_at: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  notes: string | null;
  line_count: number;
  pending_measurements: number;
}

export interface ReconciliationLineView {
  id: string;
  session_id: string;
  station_id: string;
  tank_id: string;
  tank_code: string;
  tank_name: string;
  capacity: number;
  fuel_type_id: string;
  fuel_code: string;
  fuel_name: string;
  fuel_color: string;
  business_date: string;
  shift_code: string;
  session_status: ReconciliationStatus;

  opening_qty: number;
  delivered_qty: number;
  sold_qty: number;
  adjusted_qty: number;
  expected_closing_qty: number;

  actual_closing_qty: number | null;
  closing_reading_id: string | null;
  reading_source: ReadingSource | null;

  variance_qty: number | null;
  variance_pct: number | null;
  variance_status: VarianceStatus | null;
  writeoff_txn_id: number | null;
  notes: string | null;
  computed_at: string;
}

export interface TankReading {
  id: string;
  station_id: string;
  tank_id: string;
  reading_type: ReadingType;
  source: ReadingSource;
  business_date: string;
  reading_at: string;
  quantity: number;
  level_mm: number | null;
  temperature_c: number | null;
  water_level_mm: number | null;
  sensor_device_id: string | null;
  recorded_by: string | null;
  notes: string | null;
}

export interface AuditEntry {
  id: number;
  station_id: string | null;
  actor_id: string | null;
  actor_role: UserRole | null;
  action: 'create' | 'update' | 'delete';
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  changed_fields: string[] | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export interface NotificationItem {
  id: number;
  station_id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  entity: string | null;
  entity_id: string | null;
  target_role: UserRole | null;
  resolved_at: string | null;
  created_at: string;
}

export interface SensorDevice {
  id: string;
  station_id: string;
  tank_id: string | null;
  name: string;
  provider_key: string;
  external_id: string;
  protocol: string | null;
  status: SensorStatus;
  is_active: boolean;
  last_seen_at: string | null;
  last_reading_qty: number | null;
  last_reading_at: string | null;
  heartbeat_timeout_s: number;
  config: Record<string, unknown>;
  notes: string | null;
}

/** Payload of `public.fn_station_snapshot`. */
export interface StationSnapshot {
  business_date: string;
  stock: {
    total_system: number;
    total_available: number;
    total_capacity: number;
    tanks_total: number;
    tanks_below_min: number;
    tanks_offline: number;
  };
  today: {
    delivered: number;
    sold: number;
    adjusted: number;
    variance: number;
    delivery_count: number;
    sale_count: number;
    total_collected: number;
    total_cost: number;
    total_profit: number;
  };
  reconciliation: {
    sessions: number;
    submitted: number;
    open: number;
    total_expected: number;
    total_actual: number;
    total_variance: number;
  };
  by_fuel: Array<{
    fuel_type_id: string;
    fuel_code: string;
    fuel_name: string;
    fuel_color: string;
    sort_order: number;
    selling_price: number | null;
    system_quantity: number;
    available_quantity: number;
    capacity: number;
    tank_count: number;
    delivered_today: number;
    sold_today: number;
  }>;
  attention: {
    pending_adjustments: number;
    awaiting_review: number;
    open_alerts: number;
    critical_alerts: number;
    unreconciled_periods: number;
  };
  trend: Array<{
    business_date: string;
    delivered: number;
    sold: number;
    variance: number;
    closing_stock: number;
  }>;
  worst_variance: {
    tank_code: string;
    fuel_name: string;
    variance_qty: number;
    variance_pct: number;
    variance_status: VarianceStatus;
    business_date: string;
  } | null;
}

export interface TrendPoint {
  business_date: string;
  delivered: number;
  sold: number;
  variance: number;
  closing_stock: number;
}

/** Authenticated caller, resolved once per request. */
export interface SessionContext {
  userId: string;
  profile: Profile;
  station: Station;
  settings: SystemSettings;
}
