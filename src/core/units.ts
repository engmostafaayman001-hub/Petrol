/**
 * Volume, currency and date formatting.
 *
 * Every quantity in the ledger is stored in the station's base unit. Conversion
 * to a display unit happens here and nowhere else, so no arithmetic anywhere in
 * the application can accidentally mix units.
 */

export interface UnitDefinition {
  code: string;
  name: string;
  symbol: string;
  litersPerUnit: number;
}

export const KNOWN_UNITS: Record<string, UnitDefinition> = {
  L: { code: 'L', name: 'Litre', symbol: 'L', litersPerUnit: 1 },
  M3: { code: 'M3', name: 'Cubic metre', symbol: 'm³', litersPerUnit: 1000 },
  GAL: { code: 'GAL', name: 'US gallon', symbol: 'gal', litersPerUnit: 3.785412 },
  IGAL: { code: 'IGAL', name: 'Imperial gallon', symbol: 'gal', litersPerUnit: 4.54609 },
};

export function unitSymbol(code: string | null | undefined): string {
  if (!code) return 'L';
  return KNOWN_UNITS[code]?.symbol ?? code;
}

export function convert(value: number, fromCode: string, toCode: string): number {
  if (fromCode === toCode) return value;
  const from = KNOWN_UNITS[fromCode];
  const to = KNOWN_UNITS[toCode];
  if (!from || !to) return value;
  return (value * from.litersPerUnit) / to.litersPerUnit;
}

/** Canonical rounding for stored volumes; mirrors `public.fn_vol`. */
export function roundVolume(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

const volumeFormatters = new Map<number, Intl.NumberFormat>();

function volumeFormatter(decimals: number): Intl.NumberFormat {
  let formatter = volumeFormatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    volumeFormatters.set(decimals, formatter);
  }
  return formatter;
}

export function formatVolume(
  value: number | null | undefined,
  options: { decimals?: number; unit?: string | null; sign?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const { decimals = 0, unit, sign = false } = options;

  const body = volumeFormatter(decimals).format(Math.abs(value));
  const prefix = sign ? (value > 0 ? '+' : value < 0 ? '−' : '') : value < 0 ? '−' : '';

  return unit === null ? `${prefix}${body}` : `${prefix}${body} ${unitSymbol(unit ?? 'L')}`;
}

/** Compact form for tiles: 12,450 L becomes "12.4k". */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}${Math.round(abs)}`;
}

export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

export function formatMoney(
  value: number | null | undefined,
  currency = 'EGP',
  decimals = 2,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${value.toFixed(decimals)} ${currency}`;
  }
}

// ---------------------------------------------------------------------------
// Dates
//
// A business date is a plain calendar day with no timezone attached. Parsing it
// with `new Date('2024-05-01')` would shift it in negative-offset zones, so it
// is always handled as a string or as a local-midnight Date.
// ---------------------------------------------------------------------------

export function toBusinessDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseBusinessDate(value: string): Date {
  const [year = 1970, month = 1, day = 1] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(value: string, days: number): string {
  const date = parseBusinessDate(value);
  date.setDate(date.getDate() + days);
  return toBusinessDate(date);
}

export function formatBusinessDate(value: string | null | undefined, style: 'short' | 'long' = 'short'): string {
  if (!value) return '—';
  const date = parseBusinessDate(value.slice(0, 10));
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: style === 'long' ? 'long' : 'short',
    year: 'numeric',
    ...(style === 'long' ? { weekday: 'long' } : {}),
  }).format(date);
}

export function formatTimestamp(value: string | null | undefined, withSeconds = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  }).format(date);
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 90) return 'a minute ago';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;

  return formatBusinessDate(new Date(then).toISOString().slice(0, 10));
}
