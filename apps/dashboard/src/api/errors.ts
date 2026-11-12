/** Error raised for a `{error:{code,message,requestId}}` response (blueprint §4.2). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export type LiveUnavailableReason = 'not-configured' | 'unauthenticated' | 'network';

/**
 * Live AWS Mode cannot serve data. The UI must fail closed: show this error and
 * never fall back to synthetic data under a Live label.
 */
export class LiveUnavailableError extends Error {
  readonly reason: LiveUnavailableReason;

  constructor(reason: LiveUnavailableReason, message?: string) {
    super(message ?? `Live AWS Mode is unavailable (${reason}).`);
    this.name = 'LiveUnavailableError';
    this.reason = reason;
  }
}

/** Errors that a retry cannot fix. */
export function isNonRetryable(error: unknown): boolean {
  if (error instanceof LiveUnavailableError) return true;
  if (error instanceof ApiRequestError) return error.status >= 400 && error.status < 500;
  return false;
}
