import { useCallback, useState } from 'react';

function newKey(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * One Idempotency-Key per user intent. The key stays the same across retries
 * and double clicks of the same dialog, and is renewed only when a new intent
 * starts (`renew`, e.g. when the dialog opens).
 */
export function useIdempotencyKey(): { key: string; renew: () => void } {
  const [key, setKey] = useState(newKey);
  const renew = useCallback(() => setKey(newKey()), []);
  return { key, renew };
}
