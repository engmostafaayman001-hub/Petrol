/**
 * Error translation.
 *
 * Database errors are precise but hostile: `new row violates check constraint
 * "tanks_levels_ordered"` means nothing to a station manager at 6am. Every
 * error that can reach a user passes through here and comes out as a sentence
 * they can act on.
 *
 * The raw error is preserved on `cause` for server logs; it is never serialised
 * to the browser.
 */

export type AppErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'immutable'
  | 'capacity'
  | 'unavailable'
  | 'unknown';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly fieldErrors?: Record<string, string>;

  constructor(code: AppErrorCode, message: string, options?: { cause?: unknown; fieldErrors?: Record<string, string> }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    if (options?.fieldErrors) this.fieldErrors = options.fieldErrors;
  }
}

export const errors = {
  unauthenticated: () => new AppError('unauthenticated', 'Your session has expired. Sign in again to continue.'),
  forbidden: (what = 'perform this action') =>
    new AppError('forbidden', `You do not have permission to ${what}.`),
  notFound: (what = 'record') => new AppError('not_found', `That ${what} could not be found.`),
  validation: (message: string, fieldErrors?: Record<string, string>) =>
    new AppError('validation', message, fieldErrors ? { fieldErrors } : undefined),
  immutable: (message: string) => new AppError('immutable', message),
} as const;

/**
 * PostgreSQL error codes we deliberately raise from triggers and functions.
 * Anything a trigger raises with `RAISE EXCEPTION` already carries an
 * operator-readable message, so we surface it as-is.
 */
const PASSTHROUGH_PG_CODES = new Set([
  'P0001', // raise_exception — our own business rules
  '23514', // check_violation
  '23P01', // exclusion_violation
  '2F003', // restrict_violation raised from a function
]);

const CODE_MAP: Record<string, { code: AppErrorCode; message: string }> = {
  '23505': { code: 'conflict', message: 'That record already exists.' },
  '23503': { code: 'validation', message: 'A linked record is missing or belongs to another station.' },
  '23502': { code: 'validation', message: 'A required field was left empty.' },
  '42501': { code: 'forbidden', message: 'You do not have permission to perform this action.' },
  '22003': { code: 'validation', message: 'That number is out of the allowed range.' },
  '22P02': { code: 'validation', message: 'One of the values supplied was not in the expected format.' },
  PGRST116: { code: 'not_found', message: 'That record could not be found.' },
  PGRST301: { code: 'unauthenticated', message: 'Your session has expired. Sign in again to continue.' },
};

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

function isPostgrestError(value: unknown): value is PostgrestLikeError {
  return typeof value === 'object' && value !== null && ('code' in value || 'message' in value);
}

/** Strips the `ERROR:` / context noise psql adds around a raised message. */
function cleanMessage(message: string): string {
  return message
    .replace(/^ERROR:\s*/i, '')
    .replace(/\s*CONTEXT:[\s\S]*$/i, '')
    .trim();
}

export function toAppError(raw: unknown, fallback = 'Something went wrong. Please try again.'): AppError {
  if (raw instanceof AppError) return raw;

  if (isPostgrestError(raw)) {
    const pgCode = raw.code ?? '';
    const message = cleanMessage(raw.message ?? '');

    if (PASSTHROUGH_PG_CODES.has(pgCode) && message) {
      // Our own business rules already speak plain English.
      const code: AppErrorCode = /permission|manager|access/i.test(message)
        ? 'forbidden'
        : /capacity|exceeds/i.test(message)
          ? 'capacity'
          : /final|submitted|voided|cannot be (edited|modified|changed)/i.test(message)
            ? 'immutable'
            : 'validation';
      return new AppError(code, message, { cause: raw });
    }

    const mapped = CODE_MAP[pgCode];
    if (mapped) return new AppError(mapped.code, mapped.message, { cause: raw });

    // A row-level-security denial arrives as an empty result on write.
    if (/row-level security/i.test(message)) {
      return new AppError('forbidden', 'You do not have permission to perform this action.', { cause: raw });
    }
  }

  return new AppError('unknown', fallback, { cause: raw });
}

/** Serialisable form returned by server actions. */
export interface ActionFailure {
  ok: false;
  code: AppErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
}

export interface ActionSuccess<T> {
  ok: true;
  data: T;
}

export type ActionResult<T = undefined> = ActionSuccess<T> | ActionFailure;

export function fail(error: unknown): ActionFailure {
  const appError = toAppError(error);
  return {
    ok: false,
    code: appError.code,
    message: appError.message,
    ...(appError.fieldErrors ? { fieldErrors: appError.fieldErrors } : {}),
  };
}

export function succeed(): ActionResult<undefined>;
export function succeed<T>(data: T): ActionResult<T>;
export function succeed<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}
