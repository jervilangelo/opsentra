import type { Mode } from '@/types/domain';

/**
 * Public build-time configuration only (blueprint §9.3). Only VITE_* values are
 * bundled; never add secrets, keys, account IDs or a Cognito client secret.
 */
function readMode(value: string | undefined): Mode {
  return value === 'live' ? 'live' : 'demo';
}

function readOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const env = {
  defaultMode: readMode(import.meta.env.VITE_APP_MODE_DEFAULT),
  apiBaseUrl: readOptional(import.meta.env.VITE_API_BASE_URL),
  cognitoUserPoolId: readOptional(import.meta.env.VITE_COGNITO_USER_POOL_ID),
  cognitoClientId: readOptional(import.meta.env.VITE_COGNITO_CLIENT_ID),
  /** Hosted sign-in host, e.g. opsentra-dev-abc123.auth.ap-southeast-1.amazoncognito.com */
  cognitoDomain: readOptional(import.meta.env.VITE_COGNITO_DOMAIN),
} as const;

/** True when every public value Live mode needs is present. */
export function liveConfigured(): boolean {
  return Boolean(env.apiBaseUrl && env.cognitoClientId && env.cognitoDomain);
}

/** Single supported region (blueprint §0 principle 7). */
export const LIVE_REGION = 'ap-southeast-1';
