import { ApiRequestError, LiveUnavailableError } from './errors';

/** User-facing text for an API failure. Never includes stack traces. */
export function describeError(error: unknown): { title: string; detail: string } {
  if (error instanceof LiveUnavailableError) {
    return { title: 'Live AWS Mode is unavailable', detail: error.message };
  }
  if (error instanceof ApiRequestError) {
    const ref = error.requestId ? ` (request ${error.requestId})` : '';
    return { title: `Request failed: ${error.code}`, detail: `${error.message}${ref}` };
  }
  return { title: 'Something went wrong', detail: 'The request could not be completed.' };
}
